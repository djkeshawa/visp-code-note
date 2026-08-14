import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  buildNoteContext,
  buildSnapshot,
  getOrphanNotes,
} from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

const ATLAS = makeNote({
  path: "notes/projects/atlas.md",
  content: [
    "---",
    "title: Project Atlas",
    "tags: [project, product]",
    "---",
    "",
    "Links to [[Architecture decisions]] and [[Launch checklist]].",
    "",
    "- [ ] Prototype live editing",
    "- [x] Confirm alias syntax",
    "- [ ] Add diagnostics",
    "",
  ].join("\n"),
});

const ARCHITECTURE = makeNote({
  path: "notes/architecture-decisions.md",
  content: "# Architecture decisions\n\nSee [[Project Atlas]].\n",
});

const CHECKLIST = makeNote({
  path: "notes/launch-checklist.md",
  content: "# Launch checklist\n\nTracked in [[Project Atlas]].\n",
});

const snapshot = buildSnapshot([ATLAS, ARCHITECTURE, CHECKLIST]);

test("breaks the workspace path into breadcrumb folders and a file name", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.deepEqual(context?.folders, ["notes", "projects"]);
  assert.equal(context?.fileName, "atlas.md");
});

test("counts links in both directions and open tasks", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.equal(context?.outgoingCount, 2);
  assert.equal(context?.backlinkCount, 2);
  assert.equal(context?.taskCount, 3);
  assert.equal(context?.openTaskCount, 2);
});

test("surfaces frontmatter tags in declaration order", () => {
  assert.deepEqual(buildNoteContext(snapshot, ATLAS.uri)?.tags, ["project", "product"]);
});

test("a note at the workspace root has no breadcrumb folders", () => {
  const root = makeNote({ path: "readme.md", content: "# Readme\n" });

  const context = buildNoteContext(buildSnapshot([root]), root.uri);

  assert.deepEqual(context?.folders, []);
  assert.equal(context?.fileName, "readme.md");
});

test("an unindexed note yields no context instead of empty counters", () => {
  assert.equal(buildNoteContext(snapshot, "file:///untracked.md"), undefined);
});

/*
 * The inspector lists the mentions themselves, not just how many there are, so it can show
 * each one with the sentence it appears in.
 */
test("carries each mention with the line and the sentence it sits in", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.deepEqual(
    context?.backlinks.map((backlink) => backlink.title).sort(),
    ["Architecture decisions", "Launch checklist"],
  );
  const mention = context?.backlinks.find((backlink) => backlink.title === "Launch checklist");
  assert.equal(mention?.uri, CHECKLIST.uri);
  assert.equal(mention?.context, "Tracked in [[Project Atlas]].");
  assert.equal(mention?.line, 2);
});

test("outgoing links report whether they land anywhere", () => {
  const context = buildNoteContext(snapshot, ATLAS.uri);

  assert.deepEqual(
    context?.linksOut,
    [
      { label: "Architecture decisions", target: "Architecture decisions", resolved: true },
      { label: "Launch checklist", target: "Launch checklist", resolved: true },
    ],
  );
});

test("a link made twice is one destination, and an unwritten one is unresolved", () => {
  const repeated = makeNote({
    path: "notes/repeated.md",
    content: "# Repeated\n\n[[Project Atlas]] then [[project atlas]], and [[Someday]].\n",
  });
  const context = buildNoteContext(buildSnapshot([ATLAS, repeated]), repeated.uri);

  assert.deepEqual(
    context?.linksOut.map((link) => [link.target, link.resolved]),
    [["Project Atlas", true], ["Someday", false]],
  );
  // The count heads the list, so it counts what the list holds: destinations, not mentions.
  assert.equal(context?.outgoingCount, 2);
});

/*
 * `[[#Heading]]` and `[[^block]]` point inside the note being read. The resolver answers them
 * with the note itself, so they used to arrive here with an empty target and were rendered as
 * a chip with no label that reported "the wiki-link target is invalid" when clicked.
 */
test("an anchor pointing inside the note is not a link out of it", () => {
  const anchored = makeNote({
    path: "notes/anchored.md",
    content: [
      "# Anchored",
      "",
      "## Intro",
      "",
      "See [[#Intro]], [[^somewhere]] and [[#Intro|jump]], plus [[Project Atlas]].",
      "",
    ].join("\n"),
  });
  const context = buildNoteContext(buildSnapshot([ATLAS, anchored]), anchored.uri);

  assert.deepEqual(context?.linksOut, [
    { label: "Project Atlas", target: "Project Atlas", resolved: true },
  ]);
  assert.equal(context?.outgoingCount, 1);
  assert.ok(
    context?.linksOut.every((link) => link.target.trim().length > 0),
    "no chip may be rendered without a target to open",
  );
});

test("an alias is what the link says, so the chip shows the alias", () => {
  const aliased = makeNote({
    path: "notes/aliased.md",
    content: "# Aliased\n\nSee [[Project Atlas|the Atlas work]].\n",
  });
  const context = buildNoteContext(buildSnapshot([ATLAS, aliased]), aliased.uri);

  assert.deepEqual(context?.linksOut, [
    { label: "the Atlas work", target: "Project Atlas", resolved: true },
  ]);
});

/*
 * A backlink is a mention from somewhere else. An in-note anchor resolves to the note being
 * read, so recording it made a note appear in its own backlinks list — once per anchor — and
 * inflated the count above it.
 */
test("a note is never its own backlink", () => {
  const anchored = makeNote({
    path: "notes/self-referential.md",
    content: [
      "# Self referential",
      "",
      "## Intro",
      "",
      "Jump to [[#Intro]] or [[^somewhere]] from elsewhere.",
      "",
    ].join("\n"),
  });
  const selfSnapshot = buildSnapshot([anchored]);
  const context = buildNoteContext(selfSnapshot, anchored.uri);

  assert.deepEqual(selfSnapshot.backlinks, []);
  assert.deepEqual(context?.backlinks, []);
  assert.equal(context?.backlinkCount, 0);
});

/*
 * The context is answered once per note per commit and reused for the rest of them, because
 * the note editor asks for one on every keystroke. Two snapshots must never answer for each
 * other — and they carry the same version number unless someone says otherwise, so version is
 * not what tells them apart.
 */
test("a note that gains a mention says so on the next commit", () => {
  const mentioned = makeNote({ path: "notes/mentioned.md", content: "# Mentioned\n" });
  const admirer = makeNote({
    path: "notes/admirer.md",
    content: "# Admirer\n\nAbout [[Mentioned]].\n",
  });

  const before = buildNoteContext(buildSnapshot([mentioned]), mentioned.uri);
  const after = buildNoteContext(buildSnapshot([mentioned, admirer]), mentioned.uri);

  assert.equal(before?.backlinkCount, 0);
  assert.equal(after?.backlinkCount, 1);
  assert.deepEqual(after?.backlinks.map((backlink) => backlink.title), ["Admirer"]);
});

test("a note dropped from the workspace stops having a context", () => {
  const departing = makeNote({ path: "notes/departing.md", content: "# Departing\n" });
  const staying = makeNote({ path: "notes/staying.md", content: "# Staying\n" });

  assert.ok(buildNoteContext(buildSnapshot([departing, staying]), departing.uri) !== undefined);
  assert.equal(buildNoteContext(buildSnapshot([staying]), departing.uri), undefined);
});

test("a note linking only to its own headings is still an orphan", () => {
  const anchored = makeNote({
    path: "notes/inward.md",
    content: "# Inward\n\n## A\n\nSee [[#A]].\n",
  });

  assert.deepEqual(
    getOrphanNotes(buildSnapshot([anchored])).map((note) => note.path),
    ["notes/inward.md"],
  );
});
