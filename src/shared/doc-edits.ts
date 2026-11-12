/**
 * Helpers for editDocumentPage: partial edits of a doc page done as a
 * read-modify-write of its Markdown export (ClickUp API v3 has no server-side
 * partial edit, only replace/append/prepend).
 */

export interface DocEdit {
  old_str: string;
  new_str: string;
}

/** Counts overlapping occurrences too: "aa" occurs twice in "aaa", so it is ambiguous. */
function countOccurrences(text: string, search: string): number {
  let count = 0;
  for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + 1)) {
    count++;
  }
  return count;
}

/**
 * Applies the edits in order, each one on the result of the previous ones.
 * Every old_str must occur exactly once at the time it is applied, otherwise
 * nothing is returned and the error names the failing edit.
 */
export function applyEdits(content: string, edits: DocEdit[]): string {
  return edits.reduce((current, edit, index) => {
    const label = `edit ${index + 1}`;
    if (!edit.old_str) {
      throw new Error(`${label}: old_str is empty`);
    }
    const count = countOccurrences(current, edit.old_str);
    if (count === 0) {
      throw new Error(`${label}: old_str not found`);
    }
    if (count > 1) {
      throw new Error(`${label}: old_str found ${count} times, add surrounding text to make it unique`);
    }
    // split/join instead of replace(): `$&`, `$1`... in new_str stay literal
    return current.split(edit.old_str).join(edit.new_str);
  }, content);
}

/**
 * Returns the first raw HTML tag of the Markdown text, outside code, or null.
 * Verified live: ClickUp's Markdown import escapes raw HTML one level deeper on
 * every write and never converges, so a page containing some gets damaged by
 * each read-modify-write.
 */
export function findRawHtml(content: string): string | null {
  const withoutCode = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  // A tag name followed by whitespace, `/` or `>`: autolinks (<https://...>,
  // <me@example.com>) and comparisons (a < b) do not match.
  const match = withoutCode.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/);
  return match ? match[0] : null;
}

/**
 * Compares two texts line by line as multisets: lines of `expected` missing from
 * `actual`, and lines of `actual` absent from `expected`. Order is ignored on
 * purpose - the point is to spot what ClickUp's import rewrote, not to align.
 */
export function compareLines(expected: string, actual: string): { missing: string[]; unexpected: string[] } {
  const remaining = new Map<string, number>();
  for (const line of actual.split("\n")) {
    remaining.set(line, (remaining.get(line) || 0) + 1);
  }

  const missing: string[] = [];
  for (const line of expected.split("\n")) {
    const count = remaining.get(line) || 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else {
      missing.push(line);
    }
  }

  const unexpected: string[] = [];
  for (const line of actual.split("\n")) {
    const count = remaining.get(line) || 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      // Lines matched against `expected` were already removed from the counts;
      // what is left is only the surplus, consumed here in actual order.
      unexpected.push(line);
    }
  }

  return { missing, unexpected };
}
