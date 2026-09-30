import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

const HOUR = 60 * 60 * 1000;

// Only setTimeout is mocked: the edit window check needs a real Date.now()
function enableTimers(t: any) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

function makeServerStub(tools: Record<string, any>) {
  return {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;
}

function setupClient(comments: any[]) {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/task/task123/comment", method: "GET" })
    .reply(200, { comments });

  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: 42, username: "me" } });

  let deleteCalled = false;
  client
    .intercept({ path: "/api/v2/comment/c1", method: "DELETE" })
    .reply(() => {
      deleteCalled = true;
      return { statusCode: 200, data: {} };
    });

  return { mockAgent, wasDeleted: () => deleteCalled };
}

function ownComment(overrides: Record<string, any> = {}) {
  return {
    id: "c1",
    date: String(Date.now() - HOUR),
    comment_text: "Posted by mistake",
    user: { id: 42, username: "me" },
    reply_count: 0,
    ...overrides,
  };
}

async function run(t: any, comments: any[]) {
  enableTimers(t);
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");
  const { mockAgent, wasDeleted } = setupClient(comments);

  const tools: Record<string, any> = {};
  registerTaskToolsWrite(makeServerStub(tools), { user: { username: "me", id: 42 } });

  const result = await tools.deleteComment({ task_id: "task123", comment_id: "c1" });

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();

  return { text: result.content[0].text as string, deleted: wasDeleted() };
}

test("deleteComment deletes a recent own comment and echoes its text", async (t) => {
  const { text, deleted } = await run(t, [ownComment()]);

  assert.equal(deleted, true);
  assert.ok(text.includes("Comment deleted successfully"), text);
  assert.ok(text.includes("comment_id: c1"), text);
  assert.ok(text.includes("deleted_text: Posted by mistake"), text);
});

test("deleteComment refuses another user's comment without calling DELETE", async (t) => {
  const { text, deleted } = await run(t, [ownComment({ user: { id: 7, username: "other" } })]);

  assert.equal(deleted, false);
  assert.ok(text.includes("other"), text);
  assert.ok(text.includes("user_id: 7"), text);
});

test("deleteComment refuses a comment older than the edit window", async (t) => {
  const { text, deleted } = await run(t, [ownComment({ date: String(Date.now() - 48 * HOUR) })]);

  assert.equal(deleted, false);
  assert.ok(text.includes("edit window"), text);
});
