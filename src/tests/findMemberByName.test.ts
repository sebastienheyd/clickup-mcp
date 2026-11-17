import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

const TEAM = {
  teams: [
    {
      id: "team1",
      members: [
        { user: { id: 81721662, username: "Sébastien HEYD", email: "sebastien@example.com" } },
        { user: { id: 32529560, username: "Lionel NSONDE", email: "lionel@example.com" } },
        { user: { id: 4528224, username: "Amar OUALI", email: "amar.ouali@example.com" } },
        { user: { id: 4528225, username: "Amar BENALI", email: "amar.benali@example.com" } },
        { user: { id: 7, username: "Max", email: "max@example.com" } },
        { user: { id: 8, username: "Maxime", email: "maxime@example.com" } },
      ],
    },
  ],
};

async function setup(t: any, replies: Array<{ status: number; body: any }>) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";
  const { registerSearchTools } = await import("../tools/search-tools");

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");
  for (const r of replies) {
    client.intercept({ path: "/api/v2/team", method: "GET" }).reply(r.status, r.body);
  }

  const tools: Record<string, any> = {};
  const serverStub = {
    tool: (name: string, _d: any, _s: any, _o: any, handler: any) => {
      tools[name] = handler;
    },
  } as any;
  registerSearchTools(serverStub, { user: { username: "me", id: 1 } });
  return { tools, mockAgent };
}

test("findMemberByName returns the id and a ready-to-use mention for a single match, ignoring case and accents", async (t) => {
  const { tools, mockAgent } = await setup(t, [{ status: 200, body: TEAM }]);

  const result = await tools.findMemberByName({ query: "sebastien heyd" });
  const text = result.content[0].text;
  assert.ok(text.startsWith('1 member matches'), text);
  assert.ok(text.includes("user_id: 81721662"), text);
  assert.ok(text.includes("[@Sébastien HEYD](#user_mention#81721662)"), text);

  // the member list is cached: no second /api/v2/team call is intercepted, and none is needed
  const byEmail = await tools.findMemberByName({ query: "LIONEL@example.com" });
  assert.ok(byEmail.content[0].text.includes("user_id: 32529560"), byEmail.content[0].text);

  const withAt = await tools.findMemberByName({ query: "@lionel nsonde" });
  assert.ok(withAt.content[0].text.includes("user_id: 32529560"), withAt.content[0].text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("findMemberByName lists every candidate instead of picking one when the query is ambiguous", async (t) => {
  const { tools, mockAgent } = await setup(t, [{ status: 200, body: TEAM }]);

  const result = await tools.findMemberByName({ query: "amar" });
  const text = result.content[0].text;
  assert.ok(text.includes("ambiguous"), text);
  assert.ok(text.includes("user_id: 4528224") && text.includes("user_id: 4528225"), text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("an exact name wins over longer names that merely contain it", async (t) => {
  const { tools, mockAgent } = await setup(t, [{ status: 200, body: TEAM }]);

  const result = await tools.findMemberByName({ query: "max" });
  const text = result.content[0].text;
  assert.ok(text.startsWith("1 member matches"), text);
  assert.ok(text.includes("user_id: 7,"), text);
  assert.ok(!text.includes("user_id: 8"), text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("findMemberByName says so when nobody matches", async (t) => {
  const { tools, mockAgent } = await setup(t, [{ status: 200, body: TEAM }]);

  const result = await tools.findMemberByName({ query: "nobody here" });
  assert.ok(result.content[0].text.startsWith('No workspace member matches "nobody here"'), result.content[0].text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("findMemberByName reports an API failure instead of claiming nobody matches, and retries next time", async (t) => {
  const { tools, mockAgent } = await setup(t, [
    { status: 500, body: "boom" },
    { status: 200, body: TEAM },
  ]);

  const failed = await tools.findMemberByName({ query: "lionel" });
  assert.ok(failed.content[0].text.startsWith("Error finding member"), failed.content[0].text);

  const retried = await tools.findMemberByName({ query: "lionel" });
  assert.ok(retried.content[0].text.includes("user_id: 32529560"), retried.content[0].text);

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});
