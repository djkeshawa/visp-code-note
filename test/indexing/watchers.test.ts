import { test } from "node:test";
import * as assert from "node:assert/strict";
import { installVscodeStub, StubTextDocument, StubUri } from "../support/vscodeStub";
import type { StubWorkspaceEdit, WillRenamePayload } from "../support/vscodeStub";
import type { IndexSnapshot, NoteRecord } from "../../src/domain/models";
import { buildSnapshot } from "../../src/indexing/projections";

const stub = installVscodeStub();

/* Loaded after the stub is installed, so the real modules see it as the `vscode` module. */
const { createIndexWatchers } = require("../../src/indexing/watchers") as
  typeof import("../../src/indexing/watchers");
const { readNoteRecord } = require("../../src/indexing/discovery") as
  typeof import("../../src/indexing/discovery");
const { withoutRenameParticipation } = require("../../src/indexing/renameMigration") as
  typeof import("../../src/indexing/renameMigration");

type Change = { readonly kind: "upsert" | "remove"; readonly uri: string };

interface Harness {
  readonly changes: Change[];
  readonly rebuilds: { count: number };
  readonly snapshot: IndexSnapshot;
  dispose(): void;
}

function uriOf(path: string): StubUri {
  return StubUri.file(`/vault/${path}`);
}

let active: Harness | undefined;

/** Seeds the fake workspace with these notes and subscribes the real handlers to it. */
async function open(files: Readonly<Record<string, string>>): Promise<Harness> {
  active?.dispose();
  stub.reset();
  for (const [path, content] of Object.entries(files)) {
    stub.files.set(`/vault/${path}`, content);
  }
  const records: NoteRecord[] = [];
  for (const path of Object.keys(files)) {
    const record = await readNoteRecord(uriOf(path));
    if (record) records.push(record);
  }
  const snapshot = buildSnapshot(records);
  const changes: Change[] = [];
  const rebuilds = { count: 0 };
  const subscriptions = createIndexWatchers(
    (change) => changes.push({ kind: change.kind, uri: change.uri.toString() }),
    () => { rebuilds.count += 1; },
    () => snapshot,
  );
  active = {
    changes,
    rebuilds,
    snapshot,
    dispose: () => { for (const item of subscriptions) item.dispose(); },
  };
  return active;
}

/** Fires a rename exactly as VS Code does and returns the edit the extension contributed. */
async function willRename(
  renames: readonly (readonly [string, string])[],
): Promise<StubWorkspaceEdit> {
  const pending: Promise<StubWorkspaceEdit>[] = [];
  const event: WillRenamePayload = {
    files: renames.map(([from, to]) => ({ oldUri: uriOf(from), newUri: uriOf(to) })),
    waitUntil: (thenable) => { pending.push(thenable); },
  };
  stub.willRenameFiles.fire(event);
  assert.equal(pending.length, 1, "the handler contributed an edit during event dispatch");
  return pending[0]!;
}

function textOf(edit: StubWorkspaceEdit, path: string): readonly string[] {
  const entry = edit.entries().find(([uri]) => uri.path === `/vault/${path}`);
  return (entry?.[1] ?? []).map((item) => item.newText);
}

function editedPaths(edit: StubWorkspaceEdit): readonly string[] {
  return edit.entries().map(([uri]) => uri.path).sort();
}

test("renaming a note in the Explorer rewrites the links that named it", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]] and [[Target|an alias]].\n",
    "other.md": "Also [[Target#Body]].\n",
  });
  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.deepEqual(textOf(edit, "refers.md"), ["[[Renamed]]", "[[Renamed|an alias]]"]);
  assert.deepEqual(textOf(edit, "other.md"), ["[[Renamed#Body]]"]);
  harness.dispose();
});

test("a note that writes down its own title keeps every link when its file moves", async () => {
  const harness = await open({
    "Target.md": "# Target note\n\nBody.\n",
    "refers.md": "See [[Target note]].\n",
  });
  const edit = await willRename([["Target.md", "archive/Whatever.md"]]);

  // Its title did not change, so nothing about the link is wrong — and nothing is touched.
  assert.equal(edit.size, 0);
  harness.dispose();
});

test("the renamed note's own text is never rewritten", async () => {
  const harness = await open({
    "Target.md": "Body mentioning [[Elsewhere]].\n",
    "Elsewhere.md": "Body.\n",
  });
  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.deepEqual(editedPaths(edit), [], "no heading, no frontmatter, no link of its own");
  harness.dispose();
});

test("two notes renamed at once, one linking to the other, both end up right", async () => {
  const harness = await open({
    "Alpha.md": "Alpha links to [[Beta]].\n",
    "Beta.md": "Beta links to [[Alpha]].\n",
  });
  const edit = await willRename([["Alpha.md", "One.md"], ["Beta.md", "Two.md"]]);

  assert.deepEqual(textOf(edit, "Alpha.md"), ["[[Two]]"]);
  assert.deepEqual(textOf(edit, "Beta.md"), ["[[One]]"]);
  harness.dispose();
});

test("a rename that only changes case rewrites nothing", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });
  const edit = await willRename([["Target.md", "TARGET.md"]]);

  // Note names are matched without case, so every link still lands where it did.
  assert.equal(edit.size, 0);
  harness.dispose();
});

test("a new name that collides keeps the other note's links meaning the other note", async () => {
  const harness = await open({
    "a/Mover.md": "Body.\n",
    "z/Shared.md": "Body.\n",
    "refers.md": "See [[Shared]].\n",
  });
  const edit = await willRename([["a/Mover.md", "a/Shared.md"]]);

  // `a/Shared` sorts ahead of `z/Shared`, so a bare [[Shared]] would have silently changed
  // which note it means. It gets pinned to the one the user was pointing at.
  assert.deepEqual(textOf(edit, "refers.md"), ["[[z/Shared]]"]);
  harness.dispose();
});

test("a rename that frees a name takes its links with it", async () => {
  const harness = await open({
    "a/Shared.md": "Body.\n",
    "z/Shared.md": "Body.\n",
    "refers.md": "See [[Shared]].\n",
  });
  const edit = await willRename([["a/Shared.md", "a/Moved.md"]]);

  // [[Shared]] meant `a/Shared`, which sorted first. It follows the rename rather than
  // silently becoming a link to the note that was shadowed.
  assert.deepEqual(textOf(edit, "refers.md"), ["[[Moved]]"]);
  harness.dispose();
});

test("a note renamed out of Markdown is left alone rather than half-migrated", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });
  const edit = await willRename([["Target.md", "Target.txt"]]);

  // There is no name that would still reach it, so the text the user wrote stands.
  assert.equal(edit.size, 0);
  harness.dispose();
});

test("a note dragged into an excluded folder is left alone", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });
  stub.excludes = ["**/node_modules/**", "archive/**"];
  const edit = await willRename([["Target.md", "archive/Target.md"]]);

  assert.equal(edit.size, 0);
  harness.dispose();
});

test("a file renamed into Markdown re-pins the links it would have stolen", async () => {
  const harness = await open({
    "z/Shared.md": "Body.\n",
    "refers.md": "See [[Shared]].\n",
  });
  stub.files.set("/vault/a/Shared.txt", "Body.\n");
  const edit = await willRename([["a/Shared.txt", "a/Shared.md"]]);

  assert.deepEqual(textOf(edit, "refers.md"), ["[[z/Shared]]"]);
  harness.dispose();
});

test("moving a folder keeps the relative links inside it meaning what they meant", async () => {
  const harness = await open({
    "a/Inner.md": "Out to [[../shared/Ref]].\n",
    "shared/Ref.md": "Body.\n",
    "other/shared/Ref.md": "Body.\n",
  });
  const edit = await willRename([["a", "other/a"]]);

  // VS Code fires one event for a moved folder rather than one per note inside it, and from
  // its new home `../shared/Ref` would quietly have become the other note called Ref.
  assert.deepEqual(textOf(edit, "a/Inner.md"), ["[[../../shared/Ref]]"]);
  harness.dispose();
});

test("moving a folder rewrites the links that named the folder", async () => {
  const harness = await open({
    "a/Inner.md": "Body.\n",
    "refers.md": "See [[a/Inner]].\n",
  });
  const edit = await willRename([["a", "b"]]);

  assert.deepEqual(textOf(edit, "refers.md"), ["[[Inner]]"]);
  harness.dispose();
});

test("a stale plan rewrites nothing at all rather than some of it", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "one.md": "See [[Target]].\n",
    "two.md": "See [[Target]].\n",
  });
  // One file has been edited since the index read it, and the link has moved with it.
  stub.files.set("/vault/two.md", "A sentence added first. See [[Target]].\n");

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.equal(edit.size, 0, "neither file is rewritten, not just the one that moved");
  assert.equal(stub.warnings.length, 1, "and the user is told rather than left guessing");
  harness.dispose();
});

test("an unsaved edit elsewhere does not stop the migration", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "one.md": "See [[Target]].\n",
  });
  const document = stubDocument("one.md");
  document.isDirty = true;

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.deepEqual(textOf(edit, "one.md"), ["[[Renamed]]"]);
  harness.dispose();
});

test("an unsaved edit that has moved the link stops it", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "one.md": "See [[Target]].\n",
  });
  const document = stubDocument("one.md");
  document.setText("Typing in front of it. See [[Target]].\n");
  document.isDirty = true;

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.equal(edit.size, 0);
  harness.dispose();
});

test("a rename the extension cannot plan still lets the rename happen", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "one.md": "See [[Target]].\n",
  });
  stub.files.delete("/vault/one.md");

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.equal(edit.size, 0, "an empty edit, not a rejected promise");
  harness.dispose();
});

test("the Rename Note command's own rename is not migrated a second time", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });

  // The command renames through applyEdit, which fires this event exactly as a drag does. It
  // has already planned the same rewrite plus a title change; migrating it again here rewrites
  // the links underneath its own "did this file change since the preview" check.
  const edit = await withoutRenameParticipation(() => willRename([["Target.md", "Renamed.md"]]));

  assert.equal(edit.size, 0);
  harness.dispose();
});

test("a renamed note is removed and re-read once the rename lands", async () => {
  const harness = await open({ "Target.md": "Body.\n" });
  stub.didRenameFiles.fire({
    files: [{ oldUri: uriOf("Target.md"), newUri: uriOf("Renamed.md") }],
  });

  assert.deepEqual(harness.changes, [
    { kind: "remove", uri: uriOf("Target.md").toString() },
    { kind: "upsert", uri: uriOf("Renamed.md").toString() },
  ]);
  assert.equal(harness.rebuilds.count, 0);
  harness.dispose();
});

test("a note renamed out of Markdown leaves the index without a rebuild", async () => {
  const harness = await open({ "Target.md": "Body.\n" });
  stub.didRenameFiles.fire({
    files: [{ oldUri: uriOf("Target.md"), newUri: uriOf("Target.txt") }],
  });

  assert.deepEqual(harness.changes, [{ kind: "remove", uri: uriOf("Target.md").toString() }]);
  assert.equal(harness.rebuilds.count, 0);
  harness.dispose();
});

test("moving folders re-reads the workspace once, however many moved", async () => {
  const harness = await open({ "notes/Inner.md": "Body.\n" });
  stub.didRenameFiles.fire({
    files: [
      { oldUri: uriOf("notes"), newUri: uriOf("deep/notes") },
      { oldUri: uriOf("other"), newUri: uriOf("deep/other") },
    ],
  });

  assert.deepEqual(harness.changes, [], "the file watcher glob cannot see inside a moved folder");
  assert.equal(harness.rebuilds.count, 1, "one gesture, one rebuild");
  harness.dispose();
});

test("deleting a folder re-reads the workspace, deleting a note does not", async () => {
  const harness = await open({ "notes/Inner.md": "Body.\n" });
  stub.didDeleteFiles.fire({ files: [uriOf("notes")] });
  assert.equal(harness.rebuilds.count, 1);

  stub.didDeleteFiles.fire({ files: [uriOf("loose.md")] });
  assert.deepEqual(harness.changes, [{ kind: "remove", uri: uriOf("loose.md").toString() }]);
  assert.equal(harness.rebuilds.count, 1);
  harness.dispose();
});

test("a folder dragged in re-reads the workspace, a note dragged in does not", async () => {
  const harness = await open({});
  stub.didCreateFiles.fire({ files: [uriOf("Fresh.md"), uriOf("imported")] });

  assert.deepEqual(harness.changes, [{ kind: "upsert", uri: uriOf("Fresh.md").toString() }]);
  assert.equal(harness.rebuilds.count, 1);
  harness.dispose();
});

/** Opens a note in an editor, so the migration sees the buffer rather than the file. */
function stubDocument(path: string): StubTextDocument {
  const uri = uriOf(path);
  const document = new StubTextDocument(uri, stub.files.get(uri.path) ?? "");
  stub.documents.set(uri.toString(), document);
  return document;
}
