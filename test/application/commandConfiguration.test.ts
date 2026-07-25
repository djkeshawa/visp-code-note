import assert = require("node:assert/strict");
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTRIBUTED_COMMAND_IDS, NOTE_EDITOR_VIEW_TYPE } from "../../src/vscode/ids";
import {
  openRenderedNoteCommand,
  smartViewCommand,
  type SmartViewId,
} from "../../src/vscode/providers/explorerCommands";

interface ExtensionManifest {
  readonly contributes?: {
    readonly commands?: ReadonlyArray<{ readonly command: string }>;
  };
}

test("every registered Visp command is contributed exactly once", () => {
  const manifestPath = join(__dirname, "../../../package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  const contributed = manifest.contributes?.commands?.map(({ command }) => command) ?? [];

  assert.equal(new Set(contributed).size, contributed.length);
  assert.deepEqual([...contributed].sort(), [...CONTRIBUTED_COMMAND_IDS].sort());
});

test("note tree items use VS Code's stable openWith command", () => {
  const uri = { scheme: "file", path: "/notes/example.md" };
  const command = openRenderedNoteCommand(uri);

  assert.equal(command.command, "vscode.openWith");
  assert.deepEqual(command.arguments, [uri, NOTE_EDITOR_VIEW_TYPE, { preview: false }]);
});

test("smart tree items do not attach arguments to extension commands", () => {
  const smartViews: SmartViewId[] = ["tasks", "due", "graph", "broken", "orphans"];

  for (const view of smartViews) {
    const command = smartViewCommand(view);
    if (command?.command.startsWith("vispNotes.")) {
      assert.equal(command.arguments, undefined, `${view} should use a stable command ID`);
    }
  }
});
