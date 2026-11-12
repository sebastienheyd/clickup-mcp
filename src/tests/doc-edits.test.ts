import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, findRawHtml, compareLines } from "../shared/doc-edits";

test("applyEdits replaces each old_str in order", () => {
  const content = "- [ ] 14\\. **my-service**\n- [ ] 15\\. **other**";
  const result = applyEdits(content, [
    { old_str: "- [ ] 14\\. **my-service**", new_str: "- [x] 14\\. **my-service** - deployed" },
    { old_str: "deployed", new_str: "deployed 14:02" },
  ]);
  assert.equal(result, "- [x] 14\\. **my-service** - deployed 14:02\n- [ ] 15\\. **other**");
});

test("applyEdits treats replacement patterns literally", () => {
  assert.equal(applyEdits("price: X", [{ old_str: "X", new_str: "$& $1 $$" }]), "price: $& $1 $$");
});

test("applyEdits names the edit whose old_str is missing", () => {
  assert.throws(
    () => applyEdits("abc", [{ old_str: "a", new_str: "z" }, { old_str: "nope", new_str: "x" }]),
    /edit 2: old_str not found/,
  );
});

test("applyEdits names the edit whose old_str is ambiguous", () => {
  assert.throws(() => applyEdits("a a a", [{ old_str: "a", new_str: "b" }]), /edit 1: old_str found 3 times/);
});

test("applyEdits rejects an empty old_str", () => {
  assert.throws(() => applyEdits("abc", [{ old_str: "", new_str: "x" }]), /edit 1: old_str is empty/);
});

test("findRawHtml finds HTML tags in the text", () => {
  assert.equal(
    findRawHtml('**Jean:** <span itemtype="x" itemscope="">Jean</span> ok'),
    '<span itemtype="x" itemscope="">',
  );
  assert.equal(findRawHtml("line<br>next"), "<br>");
});

test("findRawHtml ignores autolinks, comparisons and code", () => {
  assert.equal(findRawHtml("see <https://example.com> and <me@example.com>"), null);
  assert.equal(findRawHtml("if a < b and c > d"), null);
  assert.equal(findRawHtml("use `<div>` here"), null);
  assert.equal(findRawHtml("```html\n<div class=\"a\">\n```\ntext"), null);
});

test("compareLines lists lines that differ, ignoring their order", () => {
  const expected = "a\n\nb\nc";
  const actual = "a\n* b\nc\nd";
  assert.deepEqual(compareLines(expected, actual), { missing: ["", "b"], unexpected: ["* b", "d"] });
});

test("compareLines reports nothing for identical content", () => {
  assert.deepEqual(compareLines("a\nb", "a\nb"), { missing: [], unexpected: [] });
});
