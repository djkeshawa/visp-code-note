import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeWorkspaceRelativeFolder } from "../../src/application/workspacePath";

test("normalizes safe workspace-relative note folders", () => {
  assert.equal(normalizeWorkspaceRelativeFolder(" notes\\projects/../daily "), "notes/daily");
  assert.equal(normalizeWorkspaceRelativeFolder("."), "");
});

test("rejects note folders that can escape the workspace", () => {
  for (const value of ["../outside", "notes/../../outside", "/tmp/notes", "C:\\notes"] as const) {
    assert.throws(() => normalizeWorkspaceRelativeFolder(value), /workspace/);
  }
});
