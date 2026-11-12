import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

const VIEW_PATH = "/api/v2/view/doc123";

async function setup(t: any) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerDocumentToolsWrite } = await import("../tools/doc-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: 42, username: "me" } });

  const tools: Record<string, any> = {};
  registerDocumentToolsWrite({
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any);

  t.after(async () => {
    await mockAgent.close();
    // Clears the cached current user between tests
    t.mock.timers.runAll();
    t.mock.timers.reset();
  });

  return { client, tools };
}

function replyView(client: any, overrides: Record<string, any> = {}) {
  client.intercept({ path: VIEW_PATH, method: "GET" }).reply(200, {
    view: {
      id: "doc123",
      name: "Release checklist",
      type: "doc",
      creator: 42,
      parent: { id: "space1", type: 4 },
      ...overrides,
    },
  });
}

function replyPageListing(client: any) {
  client
    .intercept({ path: "/api/v3/workspaces/team1/docs/doc123/pageListing", method: "GET" })
    .reply(200, [
      { id: "page1", name: "Backend", pages: [{ id: "page2", name: "Order", pages: [] }] },
      { id: "page3", name: "Frontend", pages: [] },
    ]);
}

function captureDelete(client: any) {
  const captured = { called: false };
  client.intercept({ path: VIEW_PATH, method: "DELETE" }).reply(() => {
    captured.called = true;
    return { statusCode: 200, data: {} };
  });
  return captured;
}

function text(result: any) {
  return result.content.map((b: any) => b.text || "").join("\n");
}

test("deleteDocument deletes an own doc and echoes its pages", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client);
  replyPageListing(client);
  const deletion = captureDelete(client);

  const result = await tools.deleteDocument({ doc_id: "doc123" });

  assert.ok(deletion.called);
  const output = text(result);
  assert.match(output, /Release checklist/);
  assert.match(output, /doc123/);
  assert.match(output, /^- Backend \(page_id: page1\)$/m);
  assert.match(output, /^  - Order \(page_id: page2\)$/m);
  assert.match(output, /^- Frontend \(page_id: page3\)$/m);
  assert.match(output, /Trash/);
  assert.match(output, /Location: space space1/);
});

test("deleteDocument refuses an id that is a view but not a doc", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client, { type: "list", name: "Sprint board" });
  const deletion = captureDelete(client);

  const result = await tools.deleteDocument({ doc_id: "doc123" });

  assert.equal(deletion.called, false);
  assert.match(text(result), /not a document/);
  assert.match(text(result), /list/);
});

test("deleteDocument refuses a doc created by someone else", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client, { creator: 7 });
  const deletion = captureDelete(client);

  const result = await tools.deleteDocument({ doc_id: "doc123" });

  assert.equal(deletion.called, false);
  assert.match(text(result), /only documents you created/);
});

test("deleteDocument reports an unknown doc", async (t) => {
  const { client, tools } = await setup(t);
  client
    .intercept({ path: VIEW_PATH, method: "GET" })
    .reply(404, { err: "View not found", ECODE: "OAUTH_058" });

  const result = await tools.deleteDocument({ doc_id: "doc123" });

  assert.match(text(result), /not found/i);
});

test("deleteDocument reports a failed deletion", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client);
  replyPageListing(client);
  client.intercept({ path: VIEW_PATH, method: "DELETE" }).reply(500, "boom");

  const result = await tools.deleteDocument({ doc_id: "doc123" });

  assert.match(text(result), /500/);
});

test("deleteDocument reports a failed view lookup without calling it not found", async (t) => {
  const { client, tools } = await setup(t);
  client.intercept({ path: VIEW_PATH, method: "GET" }).reply(429, "rate limited");

  const output = text(await tools.deleteDocument({ doc_id: "doc123" }));

  assert.match(output, /429/);
  assert.doesNotMatch(output, /not found/i);
  assert.match(output, /Nothing was deleted/);
});

test("deleteDocument deletes nothing when the page listing fails", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client);
  client
    .intercept({ path: "/api/v3/workspaces/team1/docs/doc123/pageListing", method: "GET" })
    .reply(500, "boom");
  const deletion = captureDelete(client);

  const output = text(await tools.deleteDocument({ doc_id: "doc123" }));

  assert.equal(deletion.called, false);
  assert.match(output, /Nothing was deleted/);
});

test("deleteDocument deletes nothing when the page listing has an unexpected format", async (t) => {
  const { client, tools } = await setup(t);
  replyView(client);
  client
    .intercept({ path: "/api/v3/workspaces/team1/docs/doc123/pageListing", method: "GET" })
    .reply(200, { pages: [] });
  const deletion = captureDelete(client);

  const output = text(await tools.deleteDocument({ doc_id: "doc123" }));

  assert.equal(deletion.called, false);
  assert.match(output, /unexpected/);
  assert.match(output, /Nothing was deleted/);
});
