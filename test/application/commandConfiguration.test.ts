import assert = require("node:assert/strict");
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTRIBUTED_COMMAND_IDS } from "../../src/vscode/ids";

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
