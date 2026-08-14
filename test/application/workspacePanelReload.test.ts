import assert = require("node:assert/strict");
import { test } from "node:test";
// Must come first: it seeds the remembered state the panel reads as it loads.
import "../support/reloadedWorkspacePanel";
import "../../src/webview/workspace";
import { publish, rowLabels } from "../support/workspacePanelDom";
import { panelState } from "../support/workspacePanelState";

/*
 * The claim the nested tree rests on: expansion already survives a reload through the
 * `folder:<path>` keys, so nested paths need no new persistence. Worth pressing rather than
 * believing — until now no nested path had ever been written to that state, so nothing had
 * ever read one back.
 *
 * This file gets its own harness because the panel reads its remembered state exactly once, as
 * it loads. Seeding it after that would prove nothing about a reload.
 */

test("a panel coming back from a reload reopens the nested folders it was left with", () => {
  publish(panelState([
    "projects/2026/alpha/index.md",
    "projects/2025/retro.md",
    "inbox.md",
  ]));

  assert.deepEqual(rowLabels("workspace-notes"), [
    "projects2",
    "20251",
    "20261",
    "alpha1",
    "Inbox",
  ]);
});
