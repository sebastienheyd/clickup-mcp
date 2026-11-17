import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertMarkdownToClickUpBlocks,
  convertClickUpTextItemsToToolCallResult,
  parseUserMentionUrl,
  toUserMentionMarkdown,
} from "../clickup-text";

async function readAsText(items: any[]): Promise<string> {
  const blocks = await convertClickUpTextItemsToToolCallResult(items);
  return blocks
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

test("parseUserMentionUrl accepts only #user_mention#<digits>", () => {
  assert.equal(parseUserMentionUrl("#user_mention#4528224"), 4528224);
  assert.equal(parseUserMentionUrl("#user_mention#abc"), null);
  assert.equal(parseUserMentionUrl("#user_mention#"), null);
  assert.equal(parseUserMentionUrl("#user_mention#12 34"), null);
  assert.equal(parseUserMentionUrl("https://example.com/#user_mention#12"), null);
  assert.equal(parseUserMentionUrl("#other#12"), null);
});

test("[@Name](#user_mention#id) becomes a tag fragment carrying the user id", () => {
  const blocks = convertMarkdownToClickUpBlocks("Hallo [@Amar OUALI](#user_mention#4528224), bitte prüfen.");

  const mention = blocks.find((b) => b.type === "tag");
  assert.ok(mention, `expected a tag fragment, got: ${JSON.stringify(blocks)}`);
  assert.deepEqual(mention!.user, { id: 4528224 });
  assert.equal(mention!.text, "@Amar OUALI");

  const text = blocks.map((b) => b.text ?? "").join("");
  assert.ok(text.startsWith("Hallo "));
  assert.ok(text.includes(", bitte prüfen."));
});

test("a mention without the leading @ in its label gets one", () => {
  const blocks = convertMarkdownToClickUpBlocks("[Amar OUALI](#user_mention#4528224)");
  const mention = blocks.find((b) => b.type === "tag");
  assert.equal(mention?.text, "@Amar OUALI");
});

test("a mention with a non numeric id stays an ordinary link", () => {
  const blocks = convertMarkdownToClickUpBlocks("[@Amar](#user_mention#abc)");
  assert.ok(!blocks.some((b) => b.type === "tag"));
  assert.ok(blocks.some((b) => b.attributes?.link === "#user_mention#abc"));
});

test("a mention keeps the list formatting around it and works inside bold text", () => {
  const inList = convertMarkdownToClickUpBlocks("- [@Amar OUALI](#user_mention#1) a vérifier");
  const index = inList.findIndex((b) => b.type === "tag");
  assert.ok(index >= 0);
  const newline = inList[inList.length - 1];
  assert.equal(newline.text, "\n");
  assert.deepEqual(newline.attributes?.list, { list: "bullet" });

  const inBold = convertMarkdownToClickUpBlocks("**[@Amar OUALI](#user_mention#1)**");
  assert.ok(inBold.some((b) => b.type === "tag" && b.user?.id === 1));
});

test("a tag fragment from the ClickUp UI reads as [@Name](#user_mention#id)", async () => {
  const text = await readAsText([
    { text: "Hallo " },
    {
      type: "tag",
      text: "@Amar OUALI",
      user: { id: 4528224, username: "Amar OUALI", email: "amar@example.com" },
    },
    { text: " ok?\n" },
  ]);
  assert.equal(text, "Hallo [@Amar OUALI](#user_mention#4528224) ok?");
});

test("a user_mention fragment from the claude.ai connector reads the same way", async () => {
  const text = await readAsText([
    { type: "user_mention", text: "@Amar OUALI", user: { id: 4528224 } },
    { text: " ok?\n" },
  ]);
  assert.equal(text, "[@Amar OUALI](#user_mention#4528224) ok?");
});

test("the read-back name falls back to the username and survives brackets", async () => {
  const noText = await readAsText([{ type: "tag", user: { id: 7, username: "Jean" } }, { text: "\n" }]);
  assert.equal(noText, "[@Jean](#user_mention#7)");

  const brackets = await readAsText([{ type: "tag", text: "@Max [QA]", user: { id: 8 } }, { text: "\n" }]);
  assert.equal(brackets, "[@Max \\[QA\\]](#user_mention#8)");
  assert.equal(toUserMentionMarkdown(8, "Max [QA]"), "[@Max \\[QA\\]](#user_mention#8)");
  // and it parses back to the same user
  const back = convertMarkdownToClickUpBlocks(brackets);
  assert.ok(back.some((b) => b.type === "tag" && b.user?.id === 8 && b.text === "@Max [QA]"));
});

test("a tag fragment without a user (a #tag) keeps its plain text rendering", async () => {
  const text = await readAsText([{ type: "tag", text: "#release" }, { text: "\n" }]);
  assert.equal(text, "#release");
});

test("read then write restores the same mention fragment", async () => {
  const text = await readAsText([
    { text: "Ping " },
    { type: "tag", text: "@Amar OUALI", user: { id: 4528224, username: "Amar OUALI" } },
    { text: "\n" },
  ]);
  const rewritten = convertMarkdownToClickUpBlocks(text);
  const mention = rewritten.find((b) => b.type === "tag");
  assert.deepEqual(mention, { type: "tag", text: "@Amar OUALI", user: { id: 4528224 } });
});

test("task links stay task mentions and are not confused with user mentions", () => {
  const blocks = convertMarkdownToClickUpBlocks("https://app.clickup.com/t/86cb3t6t2 und [@A](#user_mention#1)");
  assert.ok(blocks.some((b) => b.type === "task_mention"));
  assert.ok(blocks.some((b) => b.type === "tag"));
});

// --- Third stored form: a comment edited by the claude.ai connector --------------------

const CONNECTOR_EDIT_FRAGMENT = {
  type: "user_mention",
  attributes: {},
  user_mention: { id: "48834283", notify: true, tag_id: "6e0f5a52-0000-4000-8000-000000000000" },
};

test("the connector's edited form (user_mention.id, no text) reads with the name from the member list", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";
  const { MockAgent, setGlobalDispatcher } = await import("undici");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  mockAgent
    .get("https://api.clickup.com")
    .intercept({ path: "/api/v2/team", method: "GET" })
    .reply(200, {
      teams: [{ id: "team1", members: [{ user: { id: 48834283, username: "Lionel NSONDE", email: "l@example.com" } }] }],
    });

  const text = await readAsText([{ text: "Merci " }, CONNECTOR_EDIT_FRAGMENT, { text: "\n" }]);
  assert.equal(text, "Merci [@Lionel NSONDE](#user_mention#48834283)");

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("the connector's edited form falls back to @<id> when the member list is unavailable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";
  const { MockAgent, setGlobalDispatcher } = await import("undici");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  mockAgent
    .get("https://api.clickup.com")
    .intercept({ path: "/api/v2/team", method: "GET" })
    .reply(500, "boom");

  const text = await readAsText([CONNECTOR_EDIT_FRAGMENT, { text: "\n" }]);
  assert.equal(text, "[@48834283](#user_mention#48834283)");

  // and the fallback is still a valid mention when written back
  const back = convertMarkdownToClickUpBlocks(text);
  assert.ok(back.some((b) => b.type === "tag" && b.user?.id === 48834283));

  await mockAgent.close();
  t.mock.timers.runAll();
  t.mock.timers.reset();
});

test("an id that is not numeric is not rendered as a mention", async () => {
  const text = await readAsText([
    { type: "user_mention", text: "@x", user_mention: { id: "abc" } },
    { text: "\n" },
  ]);
  assert.ok(!text.includes("#user_mention#"));
});
