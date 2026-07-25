import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  buildSnapshot,
  getBrokenLinks,
  getOrphanNotes,
  resolveWikiTarget,
} from "../../src/indexing/projections";
import { makeNote } from "./fixtures";

test("resolves wiki targets by relative path, title, alias, path, and stem deterministically", () => {
  const source = makeNote({ path: "root/folder/Source.md" });
  const nearby = makeNote({ path: "root/folder/Local.md", title: "Different title" });
  const namedLocal = makeNote({ path: "root/elsewhere.md", title: "Local" });
  const reference = makeNote({
    path: "root/refs/reference.md",
    title: "Canonical",
    aliases: ["Old Name"],
  });
  const sharedA = makeNote({ path: "root/a.md", title: "Shared" });
  const sharedZ = makeNote({ path: "root/z.md", title: "Shared" });
  const percentTitle = makeNote({ path: "root/rate.md", title: "Rate%23" });
  const notes = [sharedZ, reference, namedLocal, source, sharedA, nearby, percentTitle];

  assert.equal(resolveWikiTarget(notes, source.uri, "Local")?.uri, nearby.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "Canonical")?.uri, reference.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "Old%20Name")?.uri, reference.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "root/refs/reference.md")?.uri, reference.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "reference")?.uri, reference.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "Shared")?.uri, sharedA.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "Rate%2523")?.uri, percentTitle.uri);
  assert.equal(resolveWikiTarget(notes, source.uri, "")?.uri, source.uri);
  assert.doesNotThrow(() => resolveWikiTarget(notes, source.uri, "%broken"));
  assert.equal(resolveWikiTarget(notes, source.uri, "Missing"), undefined);
});

test("builds immutable links, backlink context, line numbers, tasks, and diagnostics", () => {
  const source = makeNote({
    path: "workspace/Source.md",
    content: [
      "# Source",
      "See [[Target|the target]] near here.",
      "Then [[Missing]].",
      "- [ ] Follow up #todo @due(2026-07-23)",
    ].join("\n"),
  });
  const target = makeNote({ path: "workspace/Target.md" });
  const lonely = makeNote({ path: "workspace/Lonely.md" });
  const snapshot = buildSnapshot([target, source, lonely], 7, 1234);

  assert.deepEqual(snapshot.notes.map((note) => note.path), [
    "workspace/Lonely.md",
    "workspace/Source.md",
    "workspace/Target.md",
  ]);
  assert.equal(snapshot.version, 7);
  assert.equal(snapshot.indexedAt, 1234);
  assert.deepEqual(
    snapshot.links.map((link) => link.targetUri),
    [target.uri, undefined],
  );
  assert.deepEqual(snapshot.backlinks, [
    {
      sourceUri: source.uri,
      sourceTitle: "Source",
      sourcePath: source.path,
      targetUri: target.uri,
      range: source.links[0]?.range,
      context: "See [[Target|the target]] near here.",
      line: 1,
    },
  ]);
  assert.deepEqual(
    snapshot.tasks.map((task) => ({ text: task.text, noteUri: task.noteUri, due: task.due })),
    [{ text: "Follow up", noteUri: source.uri, due: "2026-07-23" }],
  );
  assert.deepEqual(getBrokenLinks(snapshot).map((link) => link.link.target), ["Missing"]);
  assert.deepEqual(getOrphanNotes(snapshot).map((note) => note.uri), [lonely.uri]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.links));
  assert.ok(Object.isFrozen(snapshot.backlinks[0]));
});

test("treats missing heading and block anchors as broken references", () => {
  const source = makeNote({
    path: "workspace/Source.md",
    content: "[[Target#Missing]]\n[[Target^missing]]\n[[Target#Existing^stable]]\n",
  });
  const target = makeNote({
    path: "workspace/Target.md",
    content: "# Target\n\n## Existing\n\nParagraph ^stable\n",
  });
  const broken = getBrokenLinks(buildSnapshot([source, target]));

  assert.deepEqual(broken.map(({ link }) => link.raw), [
    "[[Target#Missing]]",
    "[[Target^missing]]",
  ]);
});
