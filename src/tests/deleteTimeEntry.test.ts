import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

const ENTRY = {
  id: "e1",
  user: { id: 1, username: "me" },
  task: { id: "task01", name: "Task" },
  start: "1700000000000",
  end: "1700003600000",
  duration: "3600000",
  description: "to remove",
};

async function setup(t: any, entry: any) {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTimeToolsWrite } = await import("../tools/time-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: 1, username: "me" } })
    .persist();

  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "GET" })
    .reply(200, { data: entry });

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;

  registerTimeToolsWrite(serverStub);

  return { client, mockAgent, tools };
}

async function teardown(t: any, mockAgent: MockAgent) {
  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
}

test("deleteTimeEntry deletes an own entry and echoes its values", async (t) => {
  const { client, mockAgent, tools } = await setup(t, ENTRY);

  let deleteCalled = false;
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "DELETE" })
    .reply(() => {
      deleteCalled = true;
      // The live API answers an empty object, not the deleted entry
      return { statusCode: 200, data: {} };
    });

  const result = await tools.deleteTimeEntry({ entry_id: "e1" });

  assert.equal(deleteCalled, true);
  const text = result.content[0].text;
  assert.ok(text.includes("Time entry deleted successfully"));
  assert.ok(text.includes("entry_id: e1"));
  assert.ok(text.includes("task: Task (task_id: task01)"));
  assert.ok(text.includes("duration: 1h 0m"));
  assert.ok(text.includes("description: to remove"));

  await teardown(t, mockAgent);
});

test("deleteTimeEntry refuses another user's entry without calling DELETE", async (t) => {
  const { client, mockAgent, tools } = await setup(t, { ...ENTRY, user: { id: 2, username: "other" } });

  let deleteCalled = false;
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "DELETE" })
    .reply(() => {
      deleteCalled = true;
      return { statusCode: 200, data: {} };
    });

  const result = await tools.deleteTimeEntry({ entry_id: "e1" });

  assert.equal(deleteCalled, false);
  const text = result.content[0].text;
  assert.ok(text.includes("other"));
  assert.ok(text.includes("Only your own time entries"));

  await teardown(t, mockAgent);
});

test("deleteTimeEntry reports a missing entry", async (t) => {
  const { client, mockAgent, tools } = await setup(t, ENTRY);

  // Override the GET with what the API returns for an unknown or deleted id
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/gone", method: "GET" })
    .reply(200, { data: null });

  const result = await tools.deleteTimeEntry({ entry_id: "gone" });

  assert.ok(result.content[0].text.includes("not found"));

  await teardown(t, mockAgent);
});
