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

  const result = await tools.updateTask({ task_id: "task123", name: "New Name", points: 3, append_description: "More details" });

  assert.equal(bodyCaptured.name, "New Name");
  assert.equal(bodyCaptured.points, 3);
  assert.ok(result.content[0].text.includes("points: 3"));
  assert.ok(bodyCaptured.markdown_description.includes("More details"));
  assert.ok(result.content[0].text.includes("Task updated successfully"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask removes only the links left out of linked_tasks", async (t) => {
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

  // Two existing links, one recorded in each direction: the API stores
  // `task_id`/`link_id` and puts the task being read on either side.
  const linkedTasks = [
    { task_id: "keepme", link_id: "task123" },
    { task_id: "task123", link_id: "dropme" },
  ];

  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, { id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", linked_tasks: linkedTasks });

  let removed: string[] = [];
  client
    .intercept({ path: "/api/v2/task/task123/link/dropme", method: "DELETE" })
    .reply(() => {
      removed.push("dropme");
      return { statusCode: 200, data: {} };
    });

  client
    .intercept({ path: "/api/v2/task/task123", method: "GET" })
    .reply(200, { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", linked_tasks: [linkedTasks[0]] });

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;

  registerTaskToolsWrite(serverStub, { user: { username: "me", id: "u1" } });

  // Only `keepme` is requested, so only `dropme` may be removed. Nothing else is
  // intercepted, so an attempt to re-add `keepme` or to delete
  // `/link/undefined` fails the test instead of passing silently.
  const result = await tools.updateTask({ task_id: "task123", linked_tasks: ["keepme"] });

  assert.deepEqual(removed, ["dropme"]);
  assert.ok(result.content[0].text.includes("Task updated successfully"));
  assert.ok(!result.content[0].text.includes("dependency_warnings"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

function registerUpdateTask(registerTaskToolsWrite: any) {
  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;
  registerTaskToolsWrite(serverStub, { user: { username: "me", id: "u1" } });
  return tools.updateTask;
}

test("updateTask replaces the whole description when `description` is given", async (t) => {
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
    .reply(200, { id: "task123", name: "Task", markdown_description: "old text that must vanish", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" } };
    });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  const result = await updateTask({ task_id: "task123", description: "# New\n\n- fresh list" });

  // Exact equality: no separator, no "Edit (date)" prefix, no remnant of the old text.
  assert.equal(bodyCaptured.markdown_description, "# New\n\n- fresh list");
  assert.ok(result.content[0].text.includes("Task updated successfully"));
  assert.ok(result.content[0].text.includes("description: replaced"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask appends a dated edit section when `append_description` is given", async (t) => {
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
    .reply(200, { id: "task123", name: "Task", markdown_description: "existing", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" } };
    });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  const result = await updateTask({ task_id: "task123", append_description: "addendum" });

  assert.match(bodyCaptured.markdown_description, /^existing\n\n---\n\*\*Edit \(\d{4}-\d{2}-\d{2}\):\*\* addendum$/);
  assert.ok(result.content[0].text.includes("description: appended"));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask rejects `description` together with `append_description` without touching the task", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  // No intercepts at all: any request would fail the test.
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  const result = await updateTask({ task_id: "task123", description: "a", append_description: "b" });

  assert.ok(result.content[0].text.includes("mutually exclusive"));
  assert.ok(result.content[0].text.includes("NOT updated"));

  // A custom task ID must be rejected the same way BEFORE it is resolved through
  // the API - the argument error must not cost a call of the rate-limit budget.
  const customIdResult = await updateTask({ task_id: "SOI-4422", description: "a", append_description: "b" });
  assert.ok(customIdResult.content[0].text.includes("mutually exclusive"), customIdResult.content[0].text);
  assert.ok(customIdResult.content[0].text.includes("NOT updated"));

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

function stubServer(tools: Record<string, any>) {
  return {
    tool: (name: string, _desc: string, _schema: any, _opts: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;
}

test("updateTask echoes the previous description when `description` replaces it", async (t) => {
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
    .reply(200, { id: "task123", name: "Task", markdown_description: "old spec", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" } };
    });

  const tools: Record<string, any> = {};
  registerTaskToolsWrite(stubServer(tools), { user: { username: "me", id: "u1" } });

  const result = await tools.updateTask({ task_id: "task123", description: "# New spec\n\nRewritten" });

  // The whole description is replaced, without the append separator or Edit marker
  assert.equal(bodyCaptured.markdown_description, "# New spec\n\nRewritten");
  const text = result.content[0].text;
  assert.ok(text.includes("Task updated successfully"), text);
  assert.ok(text.includes("previous_description:"), text);
  assert.ok(text.includes("old spec"), text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask clears the description with an empty string", async (t) => {
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
    .reply(200, { id: "task123", name: "Task", markdown_description: "old", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" } };
    });

  const tools: Record<string, any> = {};
  registerTaskToolsWrite(stubServer(tools), { user: { username: "me", id: "u1" } });

  const result = await tools.updateTask({ task_id: "task123", description: "" });

  assert.equal(bodyCaptured.markdown_description, "");
  assert.ok(result.content[0].text.includes("previous_description: old"), result.content[0].text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});
