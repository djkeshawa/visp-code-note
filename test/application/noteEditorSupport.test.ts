import assert = require("node:assert/strict");
import { test } from "node:test";
import type { NoteRecord } from "../../src/domain/models";
import { buildNoteSuggestions, referenceOffset } from "../../src/vscode/providers/noteEditorSupport";

function note(overrides: Partial<NoteRecord> & Pick<NoteRecord, "uri" | "path" | "title">): NoteRecord {
  return {
    fileName: overrides.path.split("/").pop() ?? "note.md",
    modifiedAt: 0,
    content: "",
    aliases: [],
    headings: [],
    blockReferences: [],
    links: [],
    tasks: [],
    tags: [],
    blocks: [],
    ...overrides,
  };
}

test("disambiguates duplicate suggestion titles with encoded paths", () => {
  const suggestions = buildNoteSuggestions([
    note({ uri: "file:///a.md", path: "docs/a|b.md", title: "Shared" }),
    note({ uri: "file:///b.md", path: "other/b.md", title: "Shared" }),
    note({ uri: "file:///c.md", path: "c.md", title: "Unique" }),
    note({ uri: "file:///d.md", path: "d.md", title: "Rate%23" }),
  ]);
  assert.deepEqual(
    suggestions.map((item) => item.target),
    ["Shared", "other/b", "Unique", "Rate%2523"],
  );
});

test("locates heading and block anchors in the target source", () => {
  const record = note({
    uri: "file:///target.md",
    path: "target.md",
    title: "Target",
    content: "# One\n\nParagraph ^stable.id\n",
    headings: [{ level: 1, text: "One", slug: "one", range: { start: 0, end: 6 } }],
    blockReferences: [{ id: "stable.id", range: { start: 17, end: 27 } }],
  });
  assert.equal(referenceOffset(record, "One", undefined), 0);
  assert.equal(referenceOffset(record, undefined, "stable.id"), 17);
});

test("includes aliases, headings, block IDs, and local reference targets", () => {
  const source = note({
    uri: "file:///source.md",
    path: "source.md",
    title: "Source",
    aliases: ["Home"],
    headings: [{ level: 2, text: "Next steps", slug: "next-steps", range: { start: 0, end: 12 } }],
    blockReferences: [{ id: "stable", range: { start: 13, end: 20 } }],
  });
  assert.deepEqual(buildNoteSuggestions([source], source.uri), [{
    label: "Source",
    target: "Source",
    path: "source.md",
    aliases: ["Home"],
    referenceTarget: "",
    headings: ["Next steps"],
    blockIds: ["stable"],
  }]);
});

test("suggestions avoid a nearer path that would steal a unique title", () => {
  const source = note({ uri: "file:///folder/source.md", path: "folder/source.md", title: "Source" });
  const nearer = note({ uri: "file:///folder/Target.md", path: "folder/Target.md", title: "Other" });
  const selected = note({ uri: "file:///other/x.md", path: "other/x.md", title: "Target" });
  const suggestion = buildNoteSuggestions([source, nearer, selected], source.uri)
    .find((item) => item.path === selected.path);
  assert.equal(suggestion?.target, "../other/x");
});
