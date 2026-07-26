import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

/**
 * Downloads a VS Code build and runs the extension-host suite against a scratch
 * workspace. The workspace is a fresh temporary directory per run, so a test that writes
 * to a note cannot leak into the next run or into the repository.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "../../..");
  const extensionTestsPath = resolve(__dirname, "./suite/index.js");
  const workspace = await mkdtemp(join(tmpdir(), "visp-notes-integration-"));

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-gpu",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-sandbox",
    ],
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
