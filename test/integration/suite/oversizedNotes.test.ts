import * as vscode from "vscode";
import {
  assert,
  delay,
  integrationTest,
  resetEditors,
  waitFor,
  writeFileText,
} from "../harness";

/**
 * A note crossing the size ceiling, in both directions, through the real index.
 *
 * This is the highest-risk logic the oversized branch added and it had no committed proof: it
 * was written against a scratch harness that has since gone. The risk is not in the size
 * comparison, which is one line, but in the transitions either side of it — a file lives in
 * `notes` or in `skippedOversized` and never in both, and every way it can move between them
 * has to commit a snapshot, or the reader is left looking at a stale window with no clue that
 * anything happened. A file created oversized was exactly that bug: it had never been in
 * `notes`, so dropping it reported nothing changed, no snapshot was published, and the one
 * message that would have told the reader where their note went never reached the screen.
 *
 * Read through the squiggle on a link to the note, because that is where a reader meets this,
 * and because the three states are three different sentences:
 *
 *   indexed    no problem reported at all;
 *   skipped    "…is 8 KB, over the … limit in vispNotes.maxNoteSizeKB", as information —
 *              the file is on disk and opens, so nothing here is wrong with the note;
 *   absent     "Unresolved wiki link", a warning, which is the one that offers to create it.
 *
 * Diagnostics are refreshed from the index's own change event, so what these assertions are
 * really waiting on is a committed snapshot. A transition that failed to commit hangs here
 * rather than passing quietly.
 */

const OVER_THE_LIMIT = `# Enormous\n\n${"x".repeat(8_000)}\n`;
/** Under the 4 KB the tests run at, over the 1 KB the ceiling is lowered to. */
const BETWEEN_THE_TWO = `# Enormous\n\n${"x".repeat(2_000)}\n`;
const UNDER_THE_LIMIT = "# Enormous\n\nSmall enough.\n";

function workspaceUri(...segments: string[]): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return vscode.Uri.joinPath(root.uri, ...segments);
}

const referring = (): vscode.Uri => workspaceUri("oversized", "refers.md");
const enormous = (): vscode.Uri => workspaceUri("oversized", "enormous.md");

/** The size ceiling, in kilobytes, or `undefined` to put the default back. */
async function setLimitKB(limit: number | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update("vispNotes.maxNoteSizeKB", limit, vscode.ConfigurationTarget.Workspace);
}

type LinkState = "indexed" | "skipped" | "absent";

/** What the Problems panel says about `refers.md`'s one wiki link right now. */
function linkState(): LinkState {
  const [first, ...rest] = vscode.languages.getDiagnostics(referring());
  if (first === undefined) return "indexed";
  assert.equal(rest.length, 0, "one link, one problem");
  return first.message.includes("vispNotes.maxNoteSizeKB") ? "skipped" : "absent";
}

async function waitForLink(expected: LinkState): Promise<void> {
  await waitFor(`the link to reach “${expected}”`, () => linkState() === expected);
}

/**
 * Waits until nothing the seeding did is still in flight, and says so.
 *
 * The two ceiling tests need this. Writing a file makes the file watcher re-read it, and a
 * watcher event that arrived after the ceiling moved would re-read the note for its own
 * reasons and flip the state without the ceiling being watched at all — a test that passes
 * with the thing it is testing deleted. Settling first leaves the ceiling as the only
 * remaining cause, and the assertion is what says the settling actually settled.
 */
async function settledAt(expected: LinkState): Promise<void> {
  await waitForLink(expected);
  await delay(1_500);
  assert.equal(linkState(), expected, "the workspace was still being re-read");
}

/** Seeds the pair fresh, with the ceiling at 4 KB so a test file need not be megabytes. */
async function seed(enormousContent: string | undefined): Promise<void> {
  await vscode.workspace.fs.delete(workspaceUri("oversized"), { recursive: true }).then(
    () => undefined,
    () => undefined,
  );
  await setLimitKB(4);
  await writeFileText(referring(), "# Refers\n\nSee [[enormous]].\n");
  if (enormousContent !== undefined) await writeFileText(enormous(), enormousContent);
  await vscode.commands.executeCommand("vispNotes.rebuildIndex");
}

async function finish(): Promise<void> {
  await setLimitKB(undefined);
  await resetEditors();
}

integrationTest("a note that grows past the ceiling stops being indexed", async () => {
  await seed(UNDER_THE_LIMIT);
  await waitForLink("indexed");

  await writeFileText(enormous(), OVER_THE_LIMIT);

  await waitForLink("skipped");
  await finish();
});

integrationTest("a note that shrinks back under the ceiling is indexed again", async () => {
  await seed(OVER_THE_LIMIT);
  await waitForLink("skipped");

  await writeFileText(enormous(), UNDER_THE_LIMIT);

  await waitForLink("indexed");
  await finish();
});

integrationTest("a note created already over the ceiling is still accounted for", async () => {
  /*
   * The regression. This file was never in `notes`, so the drop reported nothing changed and
   * no snapshot was committed — the link went on reading "unresolved", offering to create the
   * file that had just been written.
   */
  await seed(undefined);
  await waitForLink("absent");

  await writeFileText(enormous(), OVER_THE_LIMIT);

  await waitForLink("skipped");
  await finish();
});

integrationTest("deleting an oversized note takes it out of the skipped list too", async () => {
  await seed(OVER_THE_LIMIT);
  await waitForLink("skipped");

  // Deleted the way the Explorer deletes, so the file operation events fire as they do for a
  // reader who pressed Delete on it.
  const edit = new vscode.WorkspaceEdit();
  edit.deleteFile(enormous());
  assert.ok(await vscode.workspace.applyEdit(edit), "the delete was applied");

  // Both maps have to be asked. A file sits in one or the other, and forgetting only the one
  // it was not in would leave a deleted file being reported as merely too large, for ever.
  await waitForLink("absent");
  await finish();
});

integrationTest("lowering the ceiling under an indexed note skips it", async () => {
  /*
   * Only the linked note crosses the new ceiling. Lowering it far enough to catch the note
   * doing the linking as well takes that one out of the index too, and a note that is not in
   * the index reports no problems at all — which reads here as "everything is fine".
   */
  await seed(BETWEEN_THE_TWO);
  await settledAt("indexed");

  await setLimitKB(1);

  await waitForLink("skipped");
  await finish();
});

integrationTest("raising the ceiling over a skipped note brings it back", async () => {
  // The promise the workspace panel's footer makes in so many words — "Raise
  // vispNotes.maxNoteSizeKB to include them" — with nothing else touched. Nothing re-reads a
  // file on its own, so this only works because the index watches this setting.
  await seed(OVER_THE_LIMIT);
  await settledAt("skipped");

  await setLimitKB(1024);

  await waitForLink("indexed");
  await finish();
});

integrationTest("an oversized note moved to another folder is still skipped, not lost", async () => {
  await seed(OVER_THE_LIMIT);
  await waitForLink("skipped");

  // The reader would have to have written the link by path for it to survive the move, so the
  // link is expected to stop finding it — what must not happen is the file being forgotten as
  // a skipped one and coming back as an ordinary missing note under its new name.
  const moved = workspaceUri("oversized", "archive", "enormous.md");
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(enormous(), moved, { overwrite: true, ignoreIfExists: false });
  assert.ok(await vscode.workspace.applyEdit(edit), "the rename was applied");

  await writeFileText(referring(), "# Refers\n\nSee [[archive/enormous]].\n");

  await waitForLink("skipped");
  await finish();
});
