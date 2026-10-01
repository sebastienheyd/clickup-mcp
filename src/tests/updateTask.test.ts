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

test("updateTask removes dependencies read from the flat `dependencies` array", async (t) => {
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

  // The task payload has no `blocking`/`waiting_on` arrays: both directions are
  // records of one `dependencies` array, with this task on either side.
  const dependencies = [
    { task_id: "task123", depends_on: "waitme", type: 1 },
    { task_id: "blockme", depends_on: "task123", type: 1 },
    { task_id: "task123", depends_on: "keepwaiting", type: 1 },
  ];
  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, { id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", dependencies });

  const removed: string[] = [];
  client
    .intercept({ path: "/api/v2/task/task123/dependency?depends_on=waitme", method: "DELETE" })
    .reply(() => {
      removed.push("task123 waiting on waitme");
      return { statusCode: 200, data: {} };
    });
  client
    .intercept({ path: "/api/v2/task/blockme/dependency?depends_on=task123", method: "DELETE" })
    .reply(() => {
      removed.push("blockme waiting on task123");
      return { statusCode: 200, data: {} };
    });
  client
    .intercept({ path: "/api/v2/task/task123", method: "GET" })
    .reply(200, { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", dependencies: [dependencies[2]] });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  // `keepwaiting` is still requested, so it is neither removed nor re-added: no
  // POST is intercepted, so a re-add attempt would surface as a warning.
  const result = await updateTask({ task_id: "task123", waiting_on: ["keepwaiting"], blocking: [] });

  assert.deepEqual(removed.sort(), ["blockme waiting on task123", "task123 waiting on waitme"]);
  const text = result.content[0].text;
  assert.ok(text.includes("Task updated successfully"), text);
  assert.ok(!text.includes("dependency_warnings"), text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask keeps the time of day on dates and reports the real priority", async (t) => {
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
    .reply(200, { id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      // The API returns the priority NAME, not its number
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", priority: { id: "4", priority: "low" } } };
    });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  const result = await updateTask({
    task_id: "task123",
    due_date: "2026-10-02T18:00:00+02:00",
    start_date: "2026-10-01",
    priority: "low",
  });

  // A time of day is only kept by ClickUp with the matching *_time flag
  assert.equal(bodyCaptured.due_date, Date.parse("2026-10-02T18:00:00+02:00"));
  assert.equal(bodyCaptured.due_date_time, true);
  // A bare date is an all-day value at local midnight, without a time
  assert.equal(bodyCaptured.start_date, new Date(2026, 9, 1).getTime());
  assert.equal(bodyCaptured.start_date_time, false);
  assert.equal(bodyCaptured.priority, 4);

  const text = result.content[0].text;
  assert.ok(text.includes("priority: low"), text);
  assert.ok(!text.includes("priority: unknown"), text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask resolves custom IDs in relation lists before comparing them", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  // SOI-1 and SOI-2 are the custom IDs of the tasks already related to task123
  client
    .intercept({ path: "/api/v2/task/SOI-1?custom_task_ids=true&team_id=team1", method: "GET" })
    .reply(200, { id: "waitme1" });
  client
    .intercept({ path: "/api/v2/task/SOI-2?custom_task_ids=true&team_id=team1", method: "GET" })
    .reply(200, { id: "linkme2" });
  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: "u1", username: "me" } });
  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, {
      id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123",
      dependencies: [{ task_id: "task123", depends_on: "waitme1", type: 1 }],
      linked_tasks: [{ task_id: "task123", link_id: "linkme2" }],
    });
  client
    .intercept({ path: "/api/v2/task/task123", method: "GET" })
    .reply(200, { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  // The same relations, given by custom ID (twice for SOI-1): nothing may be removed
  // or re-added - no DELETE or POST is intercepted, so any attempt shows up as a
  // dependency warning or a failed request.
  const result = await updateTask({ task_id: "task123", waiting_on: ["SOI-1", "SOI-1"], linked_tasks: ["SOI-2"] });

  const text = result.content[0].text;
  assert.ok(text.includes("Task updated successfully"), text);
  assert.ok(!text.includes("dependency_warnings"), text);
  assert.ok(text.includes("waiting_on: waitme1"), text);

  (mockAgent as any).assertNoPendingInterceptors();
  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask refuses an invalid or impossible date before any request", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  // No intercepts at all: the date must be rejected before the first request
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const updateTask = registerUpdateTask(registerTaskToolsWrite);

  const unparseable = await updateTask({ task_id: "task123", due_date: "demain" });
  assert.ok(/Invalid due_date "demain"/.test(unparseable.content[0].text), unparseable.content[0].text);

  // JavaScript would roll these over to March 3rd instead of rejecting them
  for (const value of ["2026-02-31", "2026-02-31T10:00:00+02:00"]) {
    const result = await updateTask({ task_id: "task123", start_date: value });
    assert.ok(/Invalid start_date .* is not a calendar date/.test(result.content[0].text), result.content[0].text);
  }

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("updateTask resolves a custom parent_task_id before sending it as parent", async (t) => {
  t.mock.timers.enable();
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerTaskToolsWrite } = await import("../tools/task-write-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  client
    .intercept({ path: "/api/v2/task/SOI-10?custom_task_ids=true&team_id=team1", method: "GET" })
    .reply(200, { id: "parent10" });
  client
    .intercept({ path: "/api/v2/user", method: "GET" })
    .reply(200, { user: { id: "u1", username: "me" } });
  client
    .intercept({ path: "/api/v2/task/task123?include_markdown_description=true", method: "GET" })
    .reply(200, { id: "task123", name: "Task", markdown_description: "", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123" });

  let bodyCaptured: any;
  client
    .intercept({ path: "/api/v2/task/task123", method: "PUT" })
    .reply((opts) => {
      bodyCaptured = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "task123", name: "Task", status: { status: "open", type: "open" }, assignees: [], url: "https://app.clickup.com/t/task123", parent: "parent10" } };
    });

  const updateTask = registerUpdateTask(registerTaskToolsWrite);
  const result = await updateTask({ task_id: "task123", parent_task_id: "SOI-10" });

  // ClickUp answers a custom ID in `parent` with a bare 500 - only the internal ID works
  assert.equal(bodyCaptured.parent, "parent10");
  assert.ok(result.content[0].text.includes("parent_task_id: parent10"), result.content[0].text);

  (mockAgent as any).assertNoPendingInterceptors();
  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});
