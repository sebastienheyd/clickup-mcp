import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

test("updateTask updates name and description", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: "u1", username: "me" } });

  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, { id: "task123", name: "Old", markdown_description: "existing", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "New Name", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" } };
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

  registerTaskToolsWrite(serverStub, { user: { username: "me", id: "u1" } });

  const result = await tools.updateTask({ task_id: "task123", name: "New Name", append_description: "More details", points: 3 });

  assert.equal(bodyCaptured.name, "New Name");
  assert.equal(bodyCaptured.points, 3);
  assert.ok(result.content[0].text.includes("points: 3"));
  assert.ok(bodyCaptured.markdown_description.includes("More details"));
  assert.ok(result.content[0].text.includes("Task updated successfully"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask removes assignees and clears values with null", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: "u1", username: "me" } });

  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, { id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [{ id: "u2", username: "other" }], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], points: null, url: "https://app.clickup.com/t/task123" } };
    });

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;

  registerTaskToolsWrite(serverStub, { user: { username: "me", id: "u1" } });

  const result = await tools.updateTask({
    task_id: "task123",
    remove_assignees: ["u2"],
    due_date: null,
    start_date: null,
    time_estimate: null,
    points: null,
  });

  assert.deepEqual(bodyCaptured.assignees, { add: [], rem: ["u2"] });
  assert.equal(bodyCaptured.due_date, null);
  assert.equal(bodyCaptured.start_date, null);
  assert.equal(bodyCaptured.time_estimate, 0);
  assert.equal(bodyCaptured.points, null);
  const text = result.content[0].text;
  assert.ok(text.includes("removed_assignees: u2"));
  assert.ok(text.includes("due_date: cleared"));
  assert.ok(text.includes("start_date: cleared"));
  assert.ok(text.includes("time_estimate: cleared"));
  assert.ok(text.includes("points: cleared"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});
