import assert = require("node:assert/strict");
import { test } from "node:test";
import { planMissingNotePath } from "../../src/application/missingNotePath";

test("plans relative and workspace-root missing note paths", () => {
  assert.deepEqual(planMissingNotePath("folder/Source.md", "../Foo"), {
    relativePath: "Foo.md",
    title: "Foo",
  });
  assert.deepEqual(planMissingNotePath("folder/Source.md", "./nested/Foo.md"), {
    relativePath: "folder/nested/Foo.md",
    title: "Foo",
  });
  assert.deepEqual(planMissingNotePath("folder/Source.md", "/Root"), {
    relativePath: "Root.md",
    title: "Root",
  });
  assert.equal(planMissingNotePath("folder/Source.md", "Title"), undefined);
});

test("rejects traversal and unsafe path file names", () => {
  assert.throws(() => planMissingNotePath("Source.md", "../../Outside"), /escape/);
  assert.throws(() => planMissingNotePath("Source.md", "./Bad|Name"), /safe/);
});
