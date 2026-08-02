import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildWorkspaceSearchResults } from "../../src/application/workspaceSearch";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

function vault(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeNote({
      path: `notes/note-${index}.md`,
      content: `# Note ${index}\nFiller prose about topic-${index} and shared vocabulary.\n`,
    }));
}

test("narrowed search finds matches wherever they live", () => {
  const notes = [
    ...vault(30),
    makeNote({ path: "notes/needle.md", content: "# Quiet\nAn unmistakable zephyr crosses the body.\n" }),
    makeNote({
      path: "notes/meta.md",
      content: "---\ntitle: Cartography\naliases: [Atlas Redux]\ntags: [expedition]\n---\n# Cartography\nPlain text.\n",
    }),
  ];
  const snapshot = buildSnapshot(notes, 1, 1);

  const cases = [
    ["zephyr", "body", "notes/needle.md"],
    ["cartography", "title", "notes/meta.md"],
    ["atlas redux", "alias", "notes/meta.md"],
    ["expedition", "tag", "notes/meta.md"],
    ["needle", "path", "notes/needle.md"],
  ] as const;
  for (const [query, field, path] of cases) {
    const result = buildWorkspaceSearchResults(snapshot, query)[0];
    assert.equal(result?.matchedField, field, query);
    assert.equal(result?.notePath, path, query);
  }

  // Terms may match in different fields of the same note.
  const crossField = buildWorkspaceSearchResults(snapshot, "cartography plain");
  assert.equal(crossField[0]?.notePath, "notes/meta.md");
  assert.equal(buildWorkspaceSearchResults(snapshot, "zephyr cartography").length, 0);
});

test("terms shorter than a trigram still match", () => {
  const snapshot = buildSnapshot(
    [...vault(10), makeNote({ path: "notes/cpp.md", content: "# Systems\nNotes on C++ RAII.\n" })],
    1,
    1,
  );

  assert.equal(buildWorkspaceSearchResults(snapshot, "c+")[0]?.notePath, "notes/cpp.md");
  const mixed = buildWorkspaceSearchResults(snapshot, "on raii");
  assert.equal(mixed[0]?.notePath, "notes/cpp.md");
});

test("search stays correct as notes change, appear, and disappear between snapshots", () => {
  const stable = vault(20);
  const before = makeNote({ path: "notes/mutable.md", content: "# Draft\nContains obsidian references.\n" });
  const first = buildSnapshot([...stable, before], 1, 1);

  // Warm the narrowing index on the first snapshot.
  assert.equal(buildWorkspaceSearchResults(first, "obsidian")[0]?.notePath, "notes/mutable.md");

  const after = makeNote({ path: "notes/mutable.md", content: "# Draft\nNow it mentions basalt instead.\n" });
  const added = makeNote({ path: "notes/new.md", content: "# New\nFreshly created porphyry note.\n" });
  const second = buildSnapshot([...stable, after, added], 2, 2);

  assert.equal(buildWorkspaceSearchResults(second, "obsidian").length, 0);
  assert.equal(buildWorkspaceSearchResults(second, "basalt")[0]?.notePath, "notes/mutable.md");
  assert.equal(buildWorkspaceSearchResults(second, "porphyry")[0]?.notePath, "notes/new.md");

  const third = buildSnapshot(stable, 3, 3);
  assert.equal(buildWorkspaceSearchResults(third, "basalt").length, 0);
  assert.equal(buildWorkspaceSearchResults(third, "porphyry").length, 0);
  assert.equal(buildWorkspaceSearchResults(third, "topic-7")[0]?.notePath, "notes/note-7.md");
});

test("matches past the body indexing cap are still found", () => {
  const long = makeNote({
    path: "notes/long.md",
    content: `# Long\n${"lorem ipsum filler text ".repeat(1200)}\nfinal xenolith mention\n`,
  });
  assert.ok(long.content.length > 16 * 1024, "fixture must exceed the body index cap");
  const snapshot = buildSnapshot([...vault(10), long], 1, 1);

  const result = buildWorkspaceSearchResults(snapshot, "xenolith")[0];
  assert.equal(result?.notePath, "notes/long.md");
  assert.equal(result?.offset, long.content.indexOf("xenolith"));
});

test("matching is case-insensitive in both directions with correct offsets", () => {
  const note = makeNote({ path: "notes/case.md", content: "# Case\nBefore 😀 the MixedCase Token here.\n" });
  const snapshot = buildSnapshot([...vault(10), note], 1, 1);

  for (const query of ["mixedcase token", "MIXEDCASE TOKEN", "MixedCase Token"]) {
    const result = buildWorkspaceSearchResults(snapshot, query)[0];
    assert.equal(result?.notePath, "notes/case.md", query);
    assert.equal(result?.offset, note.content.indexOf("MixedCase"), query);
  }
});

test("a term found only in tasks still returns the task", () => {
  const note = makeNote({
    path: "notes/tasks.md",
    content: "# Chores\n- [ ] Recalibrate the flux capacitor #hardware\n",
  });
  const snapshot = buildSnapshot([...vault(10), note], 1, 1);

  const results = buildWorkspaceSearchResults(snapshot, "recalibrate");
  assert.ok(results.some((result) => result.kind === "task"));
});
