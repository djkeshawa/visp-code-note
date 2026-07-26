import * as assert from "node:assert/strict";
import * as vscode from "vscode";

/**
 * A very small test runner for the extension host.
 *
 * The repository already uses `node:test` for its pure-logic suites, but that runner
 * expects to own the process, which it cannot inside VS Code. Rather than add a second
 * test framework — and the dependency tree that comes with it — these suites register
 * plain async functions and this file reports the results.
 */

export interface IntegrationTest {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const registered: IntegrationTest[] = [];

export function integrationTest(name: string, run: () => Promise<void>): void {
  registered.push({ name, run });
}

export interface RunSummary {
  readonly passed: number;
  readonly failed: number;
  readonly failures: readonly string[];
}

export async function runRegisteredTests(): Promise<RunSummary> {
  let passed = 0;
  const failures: string[] = [];
  for (const test of registered) {
    try {
      await test.run();
      passed += 1;
      report(`  ok  ${test.name}`);
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      failures.push(`${test.name}\n${indent(detail)}`);
      report(`  FAIL ${test.name}`);
    }
  }
  return { passed, failed: failures.length, failures };
}

export { assert };

/**
 * Waits for a condition the extension reaches asynchronously — an index refresh, a
 * document change landing on disk. Polling keeps the tests independent of internal
 * timings, which is the point of testing through the real host.
 */
export async function waitFor(
  describe: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${describe}`);
    }
    await delay(50);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readFileText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export async function writeFileText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

/** Closes every editor so one test's open document cannot influence the next. */
export async function resetEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

function indent(value: string): string {
  return value.split("\n").map((line) => `      ${line}`).join("\n");
}

function report(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}
