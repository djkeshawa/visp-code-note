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
    const read = await readNoteRecord(uriOf(path));
    if (read.kind === "note") records.push(read.note);
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

  assert.deepEqual(textOf(edit, "refers.md"), ["[[Renamed|Target]]", "[[Renamed|an alias]]"]);
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

  assert.deepEqual(textOf(edit, "Alpha.md"), ["[[Two|Beta]]"]);
  assert.deepEqual(textOf(edit, "Beta.md"), ["[[One|Alpha]]"]);
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
  // which note it means. It gets pinned to the one the user was pointing at, behind the word
  // they wrote — the note they meant is still called Shared and the sentence still says so.
  assert.deepEqual(textOf(edit, "refers.md"), ["[[z/Shared|Shared]]"]);
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
  assert.deepEqual(textOf(edit, "refers.md"), ["[[Moved|Shared]]"]);
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

test("a note dragged out of an excluded folder re-pins the links it would have stolen", async () => {
  const harness = await open({
    "z/Shared.md": "Body.\n",
    "refers.md": "See [[Shared]].\n",
  });
  stub.excludes = ["**/node_modules/**", "archive/**"];
  stub.files.set("/vault/archive/Shared.md", "Body.\n");

  // It was not in the index, so nothing pointed at it — but it arrives under a name another
  // note already answers to, and that note's links have to keep meaning that note.
  const edit = await willRename([["archive/Shared.md", "a/Shared.md"]]);

  assert.deepEqual(textOf(edit, "refers.md"), ["[[z/Shared|Shared]]"]);
  harness.dispose();
});

test("a file renamed into Markdown re-pins the links it would have stolen", async () => {
  const harness = await open({
    "z/Shared.md": "Body.\n",
    "refers.md": "See [[Shared]].\n",
  });
  stub.files.set("/vault/a/Shared.txt", "Body.\n");
  const edit = await willRename([["a/Shared.txt", "a/Shared.md"]]);

  assert.deepEqual(textOf(edit, "refers.md"), ["[[z/Shared|Shared]]"]);
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

  assert.deepEqual(textOf(edit, "one.md"), ["[[Renamed|Target]]"]);
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
  const edit = await withoutRenameParticipation(
    [uriOf("Target.md"), uriOf("Renamed.md")],
    () => willRename([["Target.md", "Renamed.md"]]),
  );

  assert.equal(edit.size, 0);
  harness.dispose();
});

test("an Explorer rename during a command rename is still migrated", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "Other.md": "Body.\n",
    "refers.md": "See [[Target]] and [[Other]].\n",
  });

  /*
   * The command holds the exemption across a file rename, a content edit and a save of every
   * document that edit touched — hundreds of milliseconds on a large migration. A drag the user
   * makes inside that window is a different file and none of the command's business, and while
   * the exemption was a flag it was dropped on the floor: the file moved and its incoming links
   * stayed pointing at where it used to be, with nothing said.
   */
  const edit = await withoutRenameParticipation(
    [uriOf("Target.md"), uriOf("Renamed.md")],
    () => willRename([["Other.md", "Elsewhere.md"]]),
  );

  assert.deepEqual(textOf(edit, "refers.md"), ["[[Elsewhere|Other]]"]);
  harness.dispose();
});

/*
 * The consent story, from the two ends it has.
 *
 * This handler edits files nobody opened, during a gesture the user believes is a file rename,
 * and it is not allowed to ask — it runs under the participant timeout with the Explorer frozen
 * behind it. So it is bounded instead: it never changes a word a reader can see, and it can be
 * switched off in advance from a setting shaped like the one VS Code's own Markdown support
 * uses.
 */
test("a rename moves where a link points without changing the word in the sentence", async () => {
  const harness = await open({
    // Its title is written down, so the rename does not change what the note is called — only
    // the file name the link happened to be written with is going away.
    "Target.md": "# Real Title\n\nBody.\n",
    "refers.md": "See [[Target]] for details.\n",
  });
  const edit = await willRename([["Target.md", "Other.md"]]);

  assert.deepEqual(
    textOf(edit, "refers.md"),
    ["[[Real Title|Target]]"],
    "the sentence still reads “See Target for details.”, and the link still lands",
  );
  harness.dispose();
});

test("a link written as a path follows the note instead of freezing a route that has gone", async () => {
  const harness = await open({
    "a/Inner.md": "Body.\n",
    "refers.md": "See [[a/Inner]] and [[a/Inner#Body]].\n",
  });
  const edit = await willRename([["a", "b"]]);

  // A path is machinery, not prose. Keeping `a/Inner` in front of it would show the reader a
  // route that stopped going there, which is the opposite of leaving their words alone.
  assert.deepEqual(textOf(edit, "refers.md"), ["[[Inner]]", "[[Inner#Body]]"]);
  harness.dispose();
});

test("with the setting off, a rename touches nothing but the file", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });
  stub.settings.set("vispNotes.updateLinksOnFileMove.enabled", "never");

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.equal(edit.size, 0, "the reader said no, so no other note is opened or edited");
  assert.deepEqual(stub.warnings, [], "and declining is not a failure to warn about");
  harness.dispose();
});

/*
 * More mentions than the pool is wide.
 *
 * The documents a plan touches are opened sixteen at a time now, because a popular note meant
 * two thousand sequential round trips inside the participant timeout and an edit VS Code drops
 * when it runs out. A worker pool is the kind of thing that quietly plans one file twice and
 * another not at all, and every one of these is a note the reader never opened, so the count
 * and the contents are both worth stating.
 */
test("a note mentioned by fifty others has all fifty rewritten, none twice", async () => {
  const mentions = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [`note-${index}.md`, `See [[Target]].\n`]),
  );
  const harness = await open({ "Target.md": "Body.\n", ...mentions });

  const edit = await willRename([["Target.md", "Renamed.md"]]);

  assert.equal(edit.entries().length, 50, "one entry per mentioning note");
  for (let index = 0; index < 50; index += 1) {
    assert.deepEqual(textOf(edit, `note-${index}.md`), ["[[Renamed|Target]]"], `note-${index}.md`);
  }
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

/*
 * The three below are regressions from an adversarial audit of this migration. They share a
 * shape: the plan is correct about the link text it is rewriting and wrong about the workspace
 * it resolved that text against, so the guard that only re-reads the link lets it through.
 */

/**
 * Two ordinary Explorer gestures in a row used to write a permanently dead link into a note the
 * user never touched.
 *
 * Renaming a folder queues a full rebuild, and the snapshot the participant reads is not replaced
 * until that rebuild commits. A rename arriving in that window plans against a workspace that no
 * longer exists — and the plan is at its most dangerous precisely when it is re-pinning a link to
 * a path, because a path names a file rather than describing one.
 */
test("a link is not re-pinned onto a note the index only thinks is still there", async () => {
  const harness = await open({
    "archive/Spec.md": "Body.\n",
    "current/Spec.md": "Body.\n",
    "Journal.md": "See [[Spec]].\n",
    "Draft.md": "Body.\n",
  });
  // Gesture one: `archive` was renamed to `old`. The rebuild it queued has not committed.
  stub.files.set("/vault/old/Spec.md", stub.files.get("/vault/archive/Spec.md") ?? "");
  stub.files.delete("/vault/archive/Spec.md");

  // Gesture two, inside that window: a name the stale snapshot says is taken becomes taken.
  const edit = await willRename([["Draft.md", "Spec.md"]]);

  assert.equal(edit.size, 0, "[[archive/Spec]] would have been a link to a path that is gone");
  assert.deepEqual(stub.warnings.length, 1, "and the user is told, rather than left to find it");
  harness.dispose();
});

/**
 * `.md` is a legal file name — it is how a dotfile is made — and it leaves the note with no stem.
 *
 * The rewrite used to be emitted without checking that it named anything: `[[Target]]` became
 * `[[]]`, which does not parse as a link at all, so the link and the word the user wrote were
 * both gone. `[[Target|the alias]]` became `[[|the alias]]`, which is worse than gone — an empty
 * target resolves to the note the link sits in, so it silently pointed at itself.
 */
test("renaming a note to a name with no stem leaves the link text as the user wrote it", async () => {
  const harness = await open({
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]] and [[Target|the alias]].\n",
  });
  const edit = await willRename([["Target.md", ".md"]]);

  assert.equal(edit.size, 0, "no name reaches the note now, and [[]] is not a name");
  harness.dispose();
});

/**
 * The same rename, from inside the note being renamed.
 *
 * A link is checked by resolving it from the note it sits in, and an empty target resolves to
 * that note — so a note with no name at all verified an empty name against its own body, and the
 * check that stops `[[]]` being written into every other note let it through here. It is the same
 * one string, in the one file the reader is most likely to have open.
 */
test("a note's link to itself survives being renamed to a name with no stem", async () => {
  const harness = await open({
    "Target.md": "This note links to [[Target]] and [[Target|its alias]].\n",
  });
  const edit = await willRename([["Target.md", ".md"]]);

  assert.equal(edit.size, 0, "[[]] is not a link, and [[|its alias]] is a link to nowhere");
  harness.dispose();
});

/**
 * On a case-sensitive file system two notes can differ only in case, and the resolver — which
 * matches names without case — can only answer with one of them. The rewrite used to name the
 * one it could not reach, so the link opened a completely different note's content.
 */
test("a rewrite is never written when the name it would use reaches a different note", async () => {
  const harness = await open({
    "a/NOTE.md": "Body.\n",
    "Target.md": "Body.\n",
    "refers.md": "See [[Target]].\n",
  });
  const edit = await willRename([["Target.md", "a/note.md"]]);

  assert.equal(edit.size, 0, "[[a/note]] resolves to a/NOTE.md, which is not the renamed note");
  harness.dispose();
});
