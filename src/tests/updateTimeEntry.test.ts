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
  description: "old",
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

test("updateTimeEntry sends consistent start, end and duration", async (t) => {
  const { client, mockAgent, tools } = await setup(t, ENTRY);

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { data: [{ ...ENTRY, ...bodyCaptured }] } };
    });

  const result = await tools.updateTimeEntry({
    entry_id: "e1",
    hours: 0.5,
    start_time: "2023-11-14T23:00:00+01:00",
    description: "fixed",
    task_id: "task02",
  });

  const expectedStart = new Date("2023-11-14T23:00:00+01:00").getTime();
  assert.equal(bodyCaptured.start, expectedStart);
  assert.equal(bodyCaptured.duration, 30 * 60 * 1000);
  assert.equal(bodyCaptured.end, expectedStart + 30 * 60 * 1000);
  assert.equal(bodyCaptured.description, "fixed");
  assert.equal(bodyCaptured.tid, "task02");
  assert.equal(bodyCaptured.tags, undefined);

  const text = result.content[0].text;
  assert.ok(text.includes("Time entry updated successfully"));
  assert.ok(text.includes("entry_id: e1"));
  assert.ok(text.includes("duration: 30m"));

  await teardown(t, mockAgent);
});

test("updateTimeEntry keeps existing start when only the duration changes", async (t) => {
  const { client, mockAgent, tools } = await setup(t, ENTRY);

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { data: [{ ...ENTRY, ...bodyCaptured }] } };
    });

  await tools.updateTimeEntry({ entry_id: "e1", hours: 2 });

  // ClickUp leaves `end` untouched when only `start` is sent, so start and end
  // must always travel together and stay consistent with the duration.
  assert.equal(bodyCaptured.start, 1700000000000);
  assert.equal(bodyCaptured.duration, 2 * 60 * 60 * 1000);
  assert.equal(bodyCaptured.end, 1700000000000 + 2 * 60 * 60 * 1000);
  assert.equal(bodyCaptured.description, undefined);
  assert.equal(bodyCaptured.tid, undefined);

  await teardown(t, mockAgent);
});

test("updateTimeEntry refuses another user's entry without calling PUT", async (t) => {
  const { client, mockAgent, tools } = await setup(t, { ...ENTRY, user: { id: 2, username: "other" } });

  let putCalled = false;
  client
    .intercept({ path: "/api/v2/team/team1/time_entries/e1", method: "PUT" })
    .reply(() => {
      putCalled = true;
      return { statusCode: 200, data: {} };
    });

  const result = await tools.updateTimeEntry({ entry_id: "e1", hours: 1 });

  assert.equal(putCalled, false);
  const text = result.content[0].text;
  assert.ok(text.includes("other"));
  assert.ok(text.includes("user_id: 2"));
  assert.ok(text.includes("Only your own time entries"));

  await teardown(t, mockAgent);
});

test("updateTimeEntry refuses a running timer", async (t) => {
  const { mockAgent, tools } = await setup(t, { ...ENTRY, duration: "-1700000000000", end: undefined });

  const result = await tools.updateTimeEntry({ entry_id: "e1", hours: 1 });

  assert.ok(result.content[0].text.includes("running"));

  await teardown(t, mockAgent);
});

test("updateTimeEntry refuses a call without any field to update", async (t) => {
  const { mockAgent, tools } = await setup(t, ENTRY);

  const result = await tools.updateTimeEntry({ entry_id: "e1" });

  assert.ok(result.content[0].text.includes("No updates provided"));

  await teardown(t, mockAgent);
});
