import { test } from "node:test";
import assert from "node:assert/strict";

// config.ts (imported transitively by utils) throws at load time without these
process.env.CLICKUP_API_KEY = "test-key";
process.env.CLICKUP_TEAM_ID = "team1";

test("isTaskId accepts internal IDs of 6 or more characters", async () => {
  const { isTaskId } = await import("../shared/utils");
  assert.equal(isTaskId("869c4za0g"), true); // 9 chars (legacy)
  assert.equal(isTaskId("wdrv93ebwx"), true); // 10 chars (modern)
  assert.equal(isTaskId("abc123def456"), true); // 12 chars
  assert.equal(isTaskId("task01"), true); // exactly 6 chars
});

test("isTaskId rejects strings shorter than 6 characters", async () => {
  const { isTaskId } = await import("../shared/utils");
  assert.equal(isTaskId("task1"), false); // 5 chars
  assert.equal(isTaskId("abc"), false);
});

test("isTaskId rejects non-alphanumeric strings", async () => {
  const { isTaskId } = await import("../shared/utils");
  assert.equal(isTaskId("follow-up"), false); // hyphenated word
  assert.equal(isTaskId("SOI-4422"), false); // custom ID handled separately
});

test("isCustomTaskId recognises prefixed custom IDs", async () => {
  const { isCustomTaskId } = await import("../shared/utils");
  assert.equal(isCustomTaskId("SOI-4422"), true);
  assert.equal(isCustomTaskId("PQP-123"), true);
  assert.equal(isCustomTaskId("follow-up"), false);
  assert.equal(isCustomTaskId("869c4za0g"), false);
});
