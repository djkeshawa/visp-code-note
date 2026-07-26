import { runRegisteredTests } from "../harness";

/** Entry point VS Code loads inside the extension host. */
export async function run(): Promise<void> {
  // Importing a suite registers its tests.
  await import("./fileWrites.test.js");
  const summary = await runRegisteredTests();
  // eslint-disable-next-line no-console
  console.log(`\nintegration: ${summary.passed} passed, ${summary.failed} failed`);
  if (summary.failed > 0) {
    throw new Error(
      `${summary.failed} integration test(s) failed:\n${summary.failures.join("\n\n")}`,
    );
  }
}
