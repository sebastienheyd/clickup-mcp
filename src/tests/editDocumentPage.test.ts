import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

const PAGE_PATH = "/api/v3/workspaces/team1/docs/doc123/pages/page1";

const ORIGINAL = [
  "## Deployments",
  "",
  "- [ ] 14\\. **my-service** 1.2.0 → 1.3.0",
  "- [ ] 15\\. **other-service** 2.0.0 → 2.1.0",
].join("\n");

const TICKED = ORIGINAL.replace("- [ ] 14\\.", "- [x] 14\\.").replace("1.3.0", "1.3.0 - deployed 14:02");

async function setup(t: any) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerDocumentToolsWrite } = await import("../tools/doc-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  const tools: Record<string, any> = {};
  registerDocumentToolsWrite({
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any);

  t.after(async () => {
    await mockAgent.close();
    t.mock.timers.reset();
  });

  return { client, tools };
}

function replyPage(client: any, content: string, date_updated = 1000) {
  client
    .intercept({ path: PAGE_PATH, method: "GET" })
    .reply(200, { id: "page1", doc_id: "doc123", name: "MEP", content, date_updated });
}

function capturePut(client: any) {
  const captured: { body?: any } = {};
  client.intercept({ path: PAGE_PATH, method: "PUT" }).reply((opts: any) => {
    captured.body = JSON.parse(String(opts.body));
    return { statusCode: 200, data: {} };
  });
  return captured;
}

const TICK_EDIT = {
  old_str: "- [ ] 14\\. **my-service** 1.2.0 → 1.3.0",
  new_str: "- [x] 14\\. **my-service** 1.2.0 → 1.3.0 - deployed 14:02",
};

function text(result: any) {
  return result.content.map((b: any) => b.text || "").join("\n");
}

test("editDocumentPage writes the edited page and verifies it", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);
  const put = capturePut(client);
  replyPage(client, TICKED, 2000);

  const result = await tools.editDocumentPage({ doc_id: "doc123", page_id: "page1", edits: [TICK_EDIT] });

  assert.deepEqual(put.body, { content: TICKED, content_edit_mode: "replace", content_format: "text/md" });
  const output = text(result);
  assert.match(output, /1 edit applied/);
  assert.match(output, /date_updated: 2000/);
  assert.doesNotMatch(output, /Warning/);
  assert.doesNotMatch(output, /other-service/, "the page content is not echoed back");
});

test("editDocumentPage writes nothing when an old_str does not match exactly once", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);

  const result = await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [TICK_EDIT, { old_str: "→", new_str: "->" }],
  });

  const output = text(result);
  assert.match(output, /edit 2: old_str found 2 times/);
  assert.match(output, /page was NOT changed/);
});

test("editDocumentPage refuses a page containing raw HTML", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL + '\n**Jean:** <span itemscope="">Jean</span> done');

  const result = await tools.editDocumentPage({ doc_id: "doc123", page_id: "page1", edits: [TICK_EDIT] });

  const output = text(result);
  assert.match(output, /raw HTML/);
  assert.match(output, /<span itemscope="">/);
  assert.match(output, /page was NOT changed/);
});

test("editDocumentPage refuses a page changed since expected_date_updated", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL, 1500);

  const result = await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [TICK_EDIT],
    expected_date_updated: "1000",
  });

  const output = text(result);
  assert.match(output, /changed since/);
  assert.match(output, /1500/);
  assert.match(output, /page was NOT changed/);
});

test("editDocumentPage accepts a matching expected_date_updated", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL, 1000);
  const put = capturePut(client);
  replyPage(client, TICKED, 2000);

  await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [TICK_EDIT],
    expected_date_updated: 1000,
  });

  assert.equal(put.body.content, TICKED);
});

test("editDocumentPage dry_run checks the edits without writing", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);

  const result = await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [TICK_EDIT],
    dry_run: true,
  });

  const output = text(result);
  assert.match(output, /Dry run/);
  assert.match(output, /1 edit would be applied/);
});

test("editDocumentPage reports lines ClickUp changed outside the edits", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);
  capturePut(client);
  // ClickUp's import rewrote a bullet and dropped the blank line
  replyPage(client, TICKED.replace("\n\n", "\n").replace("- [ ] 15", "*   [ ] 15"), 2000);

  const result = await tools.editDocumentPage({ doc_id: "doc123", page_id: "page1", edits: [TICK_EDIT] });

  const output = text(result);
  assert.match(output, /Warning/);
  assert.match(output, /2 line\(s\) expected but missing/);
  assert.match(output, /1 line\(s\) not expected/);
  assert.match(output, /\*   \[ \] 15/);
});

test("editDocumentPage warns when a new_str is not found verbatim after the write", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, "Some text here");
  capturePut(client);
  // ClickUp exports italics with underscores
  replyPage(client, "Some text _here_", 2000);

  const result = await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [{ old_str: "here", new_str: "*here*" }],
  });

  assert.match(text(result), /edit 1: new_str not found verbatim/);
});

test("editDocumentPage reports a failed write", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);
  client.intercept({ path: PAGE_PATH, method: "PUT" }).reply(500, "boom");

  const result = await tools.editDocumentPage({ doc_id: "doc123", page_id: "page1", edits: [TICK_EDIT] });

  assert.match(text(result), /500/);
});

test("editDocumentPage reports a successful write whose verification read failed", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, ORIGINAL);
  capturePut(client);
  client.intercept({ path: PAGE_PATH, method: "GET" }).reply(429, "rate limited");

  const result = await tools.editDocumentPage({ doc_id: "doc123", page_id: "page1", edits: [TICK_EDIT] });

  const output = text(result);
  assert.match(output, /1 edit applied/);
  assert.match(output, /could not be verified/);
  assert.match(output, /429/);
  assert.match(output, /do NOT repeat the edits/);
  assert.doesNotMatch(output, /^Error/);
});

test("editDocumentPage does not warn about a new_str rewritten by a later edit", async (t) => {
  const { client, tools } = await setup(t);
  replyPage(client, "status: todo");
  const put = capturePut(client);
  replyPage(client, "state: finished", 2000);

  const result = await tools.editDocumentPage({
    doc_id: "doc123",
    page_id: "page1",
    edits: [
      { old_str: "todo", new_str: "done" },
      { old_str: "status: done", new_str: "state: finished" },
    ],
  });

  assert.equal(put.body.content, "state: finished");
  assert.doesNotMatch(text(result), /Warning/);
});
