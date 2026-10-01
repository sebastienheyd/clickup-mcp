import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

test("getTimeEntries requests time entries for task", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTimeToolsRead } = await import("../tools/time-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({
      path: /\/api\/v2\/team\/team1\/time_entries\?.*task_id=task01.*/,
      method: "GET",
    })
    .reply(200, {
      data: [{
        id: "e1",
        user: { id: 1, username: "me" },
        task: { id: "task01", name: "Task" },
        task_location: { list_id: "l1", list_name: "List" },
        start: "1700000000000",
        duration: "3600000",
        description: "Work",
      }],
    });

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (
      name: string,
      _desc: string,
      _schema: any,
      _opts: any,
      handler: any,
    ) => {
      tools[name] = handler;
    },
  } as any;

  registerTimeToolsRead(serverStub);

  const result = await tools.getTimeEntries({ task_id: "task01" });
  assert.ok(result.content[0].text.includes("Time Entries Summary"));
  // The entry id is what updateTimeEntry/deleteTimeEntry need to target an entry
  assert.ok(result.content[0].text.includes("(entry_id: e1)"));

  await mockAgent.close();
  t.mock.timers.reset();
});

test("getTimeEntries treats a bare end date as the whole local day", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";
  const { registerTimeToolsRead } = await import("../tools/time-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  let query: URLSearchParams | undefined;
  client
    .intercept({ path: /\/api\/v2\/team\/team1\/time_entries\?.*/, method: "GET" })
    .reply((opts) => {
      query = new URL(String(opts.path), "https://api.clickup.com").searchParams;
      return { statusCode: 200, data: { data: [] } };
    });

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;
  registerTimeToolsRead(serverStub);

  await tools.getTimeEntries({ task_id: "task01", start_date: "2026-10-01", end_date: "2026-10-01" });

  // "2026-10-01" alone used to become UTC midnight - an end bound that excluded the day
  assert.equal(query?.get("start_date"), String(new Date(2026, 9, 1, 0, 0, 0, 0).getTime()));
  assert.equal(query?.get("end_date"), String(new Date(2026, 9, 1, 23, 59, 59, 999).getTime()));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});
