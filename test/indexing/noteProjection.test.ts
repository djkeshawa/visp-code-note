import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteRecord } from "../../src/domain/models";
import { buildSnapshot } from "../../src/indexing/projections";
import { createNoteProjector } from "../../src/indexing/noteProjection";
import { makeNote } from "./fixtures";

/*
 * The invalidation table.
 *
 * A snapshot is rebuilt from cached per-note projections, and a projection is only still true
 * while the names a link can be written against still mean what they meant. This file is the
 * written-down list of which workspace changes move that name-space and which do not, because
 * getting it wrong is silent: a missed bump makes nothing slower, throws nothing and fails no
 * other test — it just leaves a link resolved to a note that no longer answers to that name,
 * inside the projection the panel, the tasks view, the graph, diagnostics, the backlinks list
 * and the editor inspector are all read from.
 *
 * Every case therefore asserts twice. What the snapshot says is the assertion that matters to
 * a reader; what the generation did is what keeps the cache honest — a counter that bumps for
 * everything would pass the first assertion and cache nothing at all.
 */

interface Committer {
  commit(notes: readonly NoteRecord[]): IndexSnapshot;
  readonly generation: number;
}

function committer(): Committer {
  const projector = createNoteProjector();
  let version = 0;
  return {
    commit(notes) {
      version += 1;
      return buildSnapshot(notes, version, version, projector);
    },
    get generation() {
      return projector.generation;
    },
  };
}

/** What a note's link with this raw text currently lands on, or undefined for nowhere. */
function landsOn(snapshot: IndexSnapshot, sourceUri: string, raw: string): string | undefined {
  return snapshot.links.find(
    (link) => link.sourceUri === sourceUri && link.link.raw === raw,
  )?.targetUri;
}

function mentionsOf(snapshot: IndexSnapshot, targetUri: string): readonly string[] {
  return snapshot.backlinks
    .filter((backlink) => backlink.targetUri === targetUri)
    .map((backlink) => backlink.sourceTitle);
}

/*
 * The source sits in a folder of its own, and the target's file name is nothing like its
 * title, on purpose. A link is resolved by relative path first and by file stem last, with
 * title and alias in between — so a source beside its target, or a target whose file is named
 * after its title, is answered by the path before the name-space is ever consulted, and would
 * make these cases pass whatever the cache did.
 */
const SOURCE = makeNote({
  path: "desk/source.md",
  content: "# Source\n\nAbout [[Target]] and [[Nickname]].\n",
});

const TARGET = makeNote({ path: "notes/t-9f2.md", title: "Target" });

const FILLER = Object.freeze(
  Array.from({ length: 6 }, (_, index) =>
    makeNote({ path: `notes/filler-${index}.md`, content: `# Filler ${index}\n` })),
);

function vault(...extra: readonly NoteRecord[]): readonly NoteRecord[] {
  return [SOURCE, ...FILLER, ...extra];
}

// ── must NOT bump ────────────────────────────────────────────────────────────

test("a body edit does not move the name-space", () => {
  const index = committer();
  index.commit(vault(TARGET));
  const before = index.generation;

  const edited = makeNote({
    path: "desk/source.md",
    content: "# Source\n\nAbout [[Target]] and [[Nickname]] and [[notes/other/target]].\n\nA new paragraph.\n",
  });
  const after = index.commit([edited, ...FILLER, TARGET]);

  assert.equal(index.generation, before, "prose is not a name");
  assert.equal(landsOn(after, SOURCE.uri, "[[Target]]"), TARGET.uri);
});

test("a body edit that writes a new link resolves it against the current names", () => {
  const index = committer();
  index.commit(vault(TARGET));
  const before = index.generation;

  const edited = makeNote({
    path: "desk/source.md",
    content: "# Source\n\nNow also [[Filler 3]].\n",
  });
  const after = index.commit([edited, ...FILLER, TARGET]);

  assert.equal(index.generation, before);
  assert.equal(
    landsOn(after, SOURCE.uri, "[[Filler 3]]"),
    FILLER[3]?.uri,
    "the note that changed must be projected again even though no name moved",
  );
});

test("a body edit elsewhere does not stale a note's own mentions", () => {
  const index = committer();
  index.commit(vault(TARGET));

  const admirer = makeNote({
    path: "notes/filler-0.md",
    content: "# Filler 0\n\nNow points at [[Target]].\n",
  });
  const after = index.commit([SOURCE, admirer, ...FILLER.slice(1), TARGET]);

  assert.deepEqual([...mentionsOf(after, TARGET.uri)].sort(), ["Filler 0", "Source"]);
});

/*
 * The index replaces a note's record whenever the file is re-read, which happens for reasons
 * that have nothing to do with the text — a touched mtime, a rebuild. The record is the cache
 * key, so this must re-project the one note without disturbing anybody else's cache entry.
 */
test("a record replaced by an equal one re-projects that note and no other", () => {
  const index = committer();
  const withTask = makeNote({
    path: "notes/tasked.md",
    content: "# Tasked\n\n- [ ] Something, mentioning [[Target]].\n",
  });
  index.commit([...vault(TARGET), { ...withTask, createdAt: 100 }]);
  const before = index.generation;

  // Same text, same name, a different record — which is all the cache is keyed on.
  const after = index.commit([...vault(TARGET), { ...withTask, createdAt: 900 }]);

  assert.equal(index.generation, before, "nothing it can be linked by has changed");
  assert.deepEqual(
    after.tasks.filter((task) => task.noteUri === withTask.uri).map((task) => task.noteCreatedAt),
    [900],
    "the snapshot must describe the record it was given, not the one it replaced",
  );
  assert.equal(
    landsOn(after, SOURCE.uri, "[[Target]]"),
    TARGET.uri,
    "and every other note's cached projection is still good",
  );
});

// ── must bump ────────────────────────────────────────────────────────────────

test("a title change in frontmatter moves the name-space", () => {
  const index = committer();
  const before = index.commit(vault(TARGET));
  assert.equal(landsOn(before, SOURCE.uri, "[[Target]]"), TARGET.uri);
  const generation = index.generation;

  // The file is untouched; only the frontmatter title moved.
  const retitled = makeNote({ path: "notes/t-9f2.md", title: "Renamed" });
  const after = index.commit(vault(retitled));

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(after, SOURCE.uri, "[[Target]]"),
    undefined,
    "nothing answers to the old title any more",
  );
});

test("an alias added moves the name-space", () => {
  const index = committer();
  const before = index.commit(vault(TARGET));
  assert.equal(landsOn(before, SOURCE.uri, "[[Nickname]]"), undefined);
  const generation = index.generation;

  const aliased = makeNote({ path: "notes/t-9f2.md", title: "Target", aliases: ["Nickname"] });
  const after = index.commit(vault(aliased));

  assert.notEqual(index.generation, generation);
  assert.equal(landsOn(after, SOURCE.uri, "[[Nickname]]"), TARGET.uri);
});

test("an alias removed moves the name-space", () => {
  const index = committer();
  const aliased = makeNote({ path: "notes/t-9f2.md", title: "Target", aliases: ["Nickname"] });
  const before = index.commit(vault(aliased));
  assert.equal(landsOn(before, SOURCE.uri, "[[Nickname]]"), TARGET.uri);
  const generation = index.generation;

  const after = index.commit(vault(TARGET));

  assert.notEqual(index.generation, generation);
  assert.equal(landsOn(after, SOURCE.uri, "[[Nickname]]"), undefined);
});

test("a note created moves the name-space", () => {
  const index = committer();
  const before = index.commit(vault());
  assert.equal(landsOn(before, SOURCE.uri, "[[Target]]"), undefined);
  const generation = index.generation;

  const after = index.commit(vault(TARGET));

  assert.notEqual(index.generation, generation);
  assert.equal(landsOn(after, SOURCE.uri, "[[Target]]"), TARGET.uri);
});

test("a note deleted moves the name-space", () => {
  const index = committer();
  index.commit(vault(TARGET));
  const generation = index.generation;

  const after = index.commit(vault());

  assert.notEqual(index.generation, generation);
  assert.equal(landsOn(after, SOURCE.uri, "[[Target]]"), undefined);
  assert.deepEqual(mentionsOf(after, TARGET.uri), []);
});

test("a note renamed moves the name-space", () => {
  const index = committer();
  const stemLink = makeNote({
    path: "desk/source.md",
    content: "# Source\n\nBy file name: [[t-9f2]].\n",
  });
  const before = index.commit([stemLink, ...FILLER, TARGET]);
  assert.equal(landsOn(before, SOURCE.uri, "[[t-9f2]]"), TARGET.uri);
  const generation = index.generation;

  // The file is renamed on disk; its title never moved.
  const renamed = makeNote({ path: "notes/quarry.md", title: "Target" });
  const after = index.commit([stemLink, ...FILLER, renamed]);

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(after, SOURCE.uri, "[[t-9f2]]"),
    undefined,
    "the old file name is nobody's name now",
  );
});

test("a note moved between folders moves the name-space", () => {
  const index = committer();
  const sibling = makeNote({
    path: "notes/team/source.md",
    content: "# Source\n\nBeside me: [[neighbour]].\n",
  });
  const neighbour = makeNote({ path: "notes/team/neighbour.md", title: "Neighbour" });
  const before = index.commit([sibling, neighbour]);
  assert.equal(landsOn(before, sibling.uri, "[[neighbour]]"), neighbour.uri);
  const generation = index.generation;

  const moved = makeNote({ path: "archive/2025/neighbour.md", title: "Neighbour" });
  const after = index.commit([sibling, moved]);

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(after, sibling.uri, "[[neighbour]]"),
    moved.uri,
    "the stem still reaches it, but only because the name-space was rebuilt",
  );
  assert.equal(
    after.links.find((link) => link.sourceUri === sibling.uri)?.targetUri,
    moved.uri,
  );
});

/*
 * The one case where a path moves and a URI does not.
 *
 * A record's path is `asRelativePath`, which includes the workspace root's own name once the
 * window holds more than one folder. Adding a second folder therefore re-labels every note in
 * the first without touching a single file, and links written with that folder name in them —
 * unresolved until now, because the name was not part of any path — start landing. Nothing
 * about the note changed, so only the path comparison can notice.
 */
test("a second workspace folder re-labels every path and is a name-space change", () => {
  const index = committer();
  const byRootedPath = makeNote({
    path: "desk/source.md",
    content: "# Source\n\nBy full path: [[vault/notes/t-9f2]].\n",
  });
  const before = index.commit([byRootedPath, TARGET]);
  assert.equal(landsOn(before, byRootedPath.uri, "[[vault/notes/t-9f2]]"), undefined);
  const generation = index.generation;

  const rooted = [byRootedPath, TARGET].map((note) => ({ ...note, path: `vault/${note.path}` }));
  const after = index.commit(rooted);

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(after, byRootedPath.uri, "[[vault/notes/t-9f2]]"),
    TARGET.uri,
    "the path the link was written against exists now",
  );
});

/*
 * An exclude glob does not reach this layer: a note falling inside one simply stops being in
 * the list, and stops being in it is the whole of what the projection must notice. The pair
 * is here because a workspace that adds `archive/**` and later takes it away is the shape a
 * user actually reports, and the second half is the one a naive counter gets wrong.
 */
test("a note excluded and later un-excluded moves the name-space both times", () => {
  const index = committer();
  const before = index.commit(vault(TARGET));
  assert.equal(landsOn(before, SOURCE.uri, "[[Target]]"), TARGET.uri);
  const first = index.generation;

  const excluded = index.commit(vault());
  const second = index.generation;
  assert.notEqual(second, first);
  assert.equal(landsOn(excluded, SOURCE.uri, "[[Target]]"), undefined);

  const restored = index.commit(vault(TARGET));
  assert.notEqual(index.generation, second);
  assert.equal(landsOn(restored, SOURCE.uri, "[[Target]]"), TARGET.uri);
});

/*
 * Two notes claiming one title is decided by `compareNotes`, which is path order — so adding
 * the alphabetically earlier one silently takes the name away from the note that had it, and
 * deleting it silently hands it back. Both directions, because a counter that only noticed
 * additions would pass the first half.
 */
test("a second note claiming the same title takes the name, and gives it back", () => {
  const index = committer();
  const first = index.commit(vault(TARGET));
  assert.equal(landsOn(first, SOURCE.uri, "[[Target]]"), TARGET.uri);
  const generation = index.generation;

  const earlier = makeNote({ path: "notes/a-9f2.md", title: "Target" });
  const contested = index.commit(vault(TARGET, earlier));

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(contested, SOURCE.uri, "[[Target]]"),
    earlier.uri,
    "the earlier path wins the title",
  );

  const released = index.commit(vault(TARGET));
  assert.equal(
    landsOn(released, SOURCE.uri, "[[Target]]"),
    TARGET.uri,
    "and the name goes back when the claimant leaves",
  );
});

/*
 * A move is the case with no textual change anywhere: neither note's title, alias or text is
 * touched, and yet the answer to `[[Target]]` moves from one to the other. Nothing but the
 * path told the resolver which of the two owned the name.
 */
test("a note moved to a path that hands a shared title to the other claimant", () => {
  const index = committer();
  const zed = makeNote({ path: "notes/zed.md", title: "Target" });
  const first = index.commit(vault(TARGET, zed));
  assert.equal(landsOn(first, SOURCE.uri, "[[Target]]"), TARGET.uri);
  const generation = index.generation;

  const moved = makeNote({ path: "zz/moved.md", title: "Target" });
  const after = index.commit(vault(moved, zed));

  assert.notEqual(index.generation, generation);
  assert.equal(
    landsOn(after, SOURCE.uri, "[[Target]]"),
    zed.uri,
    "notes/zed.md now sorts first, so it takes the title",
  );
});

// ── the escape hatch ─────────────────────────────────────────────────────────

/*
 * The whole point of the bypass is that a reader who suspects a phantom-resolved link can be
 * asked to flip one setting and say whether it went away, so the two paths must agree on
 * every commit rather than only on the first.
 */
test("the uncached projector produces the same snapshots as the cached one", () => {
  const cached = committer();
  const bypassed = (() => {
    const projector = createNoteProjector({ cache: false });
    let version = 0;
    return (notes: readonly NoteRecord[]): IndexSnapshot => {
      version += 1;
      return buildSnapshot(notes, version, version, projector);
    };
  })();

  const steps: readonly (readonly NoteRecord[])[] = [
    vault(),
    vault(TARGET),
    vault(makeNote({ path: "notes/t-9f2.md", title: "Target", aliases: ["Nickname"] })),
    vault(makeNote({ path: "notes/t-9f2.md", title: "Renamed" })),
    vault(makeNote({ path: "zz/moved.md", title: "Target" })),
    [...FILLER, TARGET],
    vault(TARGET, makeNote({ path: "notes/a-9f2.md", title: "Target" })),
    vault(TARGET, makeNote({ path: "notes/a-9f2.md", title: "Target" })),
    vault(TARGET),
  ];

  for (const notes of steps) {
    const left = cached.commit(notes);
    const right = bypassed(notes);
    assert.deepEqual(left.links, right.links);
    assert.deepEqual(left.backlinks, right.backlinks);
    assert.deepEqual(left.tasks, right.tasks);
  }
});

test("the bypass never reuses a projection", () => {
  const projector = createNoteProjector({ cache: false });
  const notes = vault(TARGET);
  const first = buildSnapshot(notes, 1, 1, projector);
  const second = buildSnapshot(notes, 2, 2, projector);

  assert.deepEqual(first.links, second.links);
  assert.notEqual(first.links[0], second.links[0]);
});

/*
 * The case above says the two paths agree while the invalidation is right. This says the
 * bypass is worth flipping, which is a different claim and the one the setting is sold on: it
 * must answer from the names in hand even when the cached path is wrong. Every case in this
 * file asserts the invalidation is right today, so the failure has to be introduced — and the
 * only way in is a record edited in place, which is exactly the shape of a missed bump: the
 * name-space moves while `sameNameSpace`'s identity short-circuit reports it did not.
 *
 * Mutating a record is not a state the index can reach — it replaces records, never edits one —
 * so this is a stand-in for the defect class, not a supported input. If the bypass ever shares
 * the invalidation decision with the cached path again, both rows read the same phantom and
 * this fails; a reader flipping the setting would otherwise be told "not the cache" by a run
 * that never re-read a single name.
 */
test("the bypass answers from the current names when the cached path has gone stale", () => {
  const answer = (cache: boolean): string | undefined => {
    const source = makeNote({ path: "desk/source.md", content: "# Source\n\nAbout [[Target]].\n" });
    const target = makeNote({ path: "notes/t-9f2.md", title: "Target" });
    const projector = createNoteProjector({ cache });
    buildSnapshot([source, target], 1, 1, projector);
    // A record is readonly to everyone who is playing fair, which is why this needs the cast.
    (target as { title: string }).title = "Renamed";
    return landsOn(buildSnapshot([source, target], 2, 2, projector), source.uri, "[[Target]]");
  };

  assert.equal(
    answer(true),
    "file:///notes/t-9f2.md",
    "the planted staleness must actually reach the cached path, or this proves nothing",
  );
  assert.equal(
    answer(false),
    undefined,
    "no note answers to Target any more, and the bypass is what has to say so",
  );
});
