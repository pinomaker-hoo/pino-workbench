import { test } from "node:test";
import assert from "node:assert/strict";
import { adfText, exportSchema, contextMarkdown } from "../electron/core";
import { demoIssues, demoPages } from "../src/demo";
test("extracts nested ADF paragraphs without treating content as HTML", () => {
  assert.equal(
    adfText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>untrusted</script>" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    }),
    "<script>untrusted</script>\nSecond\n",
  );
  assert.equal(adfText(null), "");
});
test("exports only selected context with provenance and timestamp", () => {
  const text = contextMarkdown(
    { issue: demoIssues[0], pages: [demoPages[0]] },
    new Date("2026-11-09T00:00:00Z"),
  );
  assert.ok(text.includes(demoIssues[0].url));
  assert.ok(text.includes(demoPages[0].url));
  assert.ok(text.includes("2026-11-09T00:00:00.000Z"));
  assert.ok(!text.includes(demoPages[1].title));
  assert.ok(text.includes("not agent instructions"));
});
test("rejects unsafe issue identifiers used in default export paths", () => {
  assert.equal(
    exportSchema.safeParse({
      issue: { ...demoIssues[0], key: "../../secret" },
      pages: [],
    }).success,
    false,
  );
});
