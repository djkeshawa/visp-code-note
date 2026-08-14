import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  planLinkMigration,
  planPathLinkMigration,
  rewriteWikiLink,
} from "../../src/application/linkMigration";
import type { WikiLink } from "../../src/domain/models";
import { buildSnapshot } from "../../src/indexing/projections";
import { makeNote } from "../indexing/fixtures";

test("rewrites only a wiki target while preserving heading, block, and alias", () => {
  const link: WikiLink = {
    raw: "[[Old#Index^parser|details]]",
    target: "Old",
    heading: "Index",
    blockId: "parser",
    alias: "details",
    range: { start: 5, end: 35 },
  };

  assert.equal(rewriteWikiLink(link, "New"), "[[New#Index^parser|details]]");
});

test("alias-preserving rename migrates path links but keeps title links", () => {
  const target = {
    uri: "file:///notes/old.md",
    path: "notes/old.md",
    title: "Old",
    aliases: [],
  } as unknown as import("../../src/domain/models").NoteRecord;
  const links = [
    { raw: "[[Old]]", target: "Old", range: { start: 0, end: 7 } },
    { raw: "[[notes/old]]", target: "notes/old", range: { start: 8, end: 21 } },
  ];
  const source = {
    uri: "file:///source.md",
    path: "source.md",
    title: "Source",
    aliases: [],
    links,
  } as unknown as import("../../src/domain/models").NoteRecord;
  const snapshot = {
    notes: [source, target],
    links: links.map((link) => ({ sourceUri: source.uri, targetUri: target.uri, link })),
    backlinks: [],
    tasks: [],
    skippedOversized: [],
    version: 1,
    indexedAt: 1,
  } as import("../../src/domain/models").IndexSnapshot;

  assert.deepEqual(
    planPathLinkMigration(snapshot, target, "New", "notes/new.md").map((item) => item.expectedText),
    ["[[notes/old]]"],
  );
});

test("alias-preserving rename migrates a title link that a duplicate would steal", () => {
  const renamed = makeNote({ path: "a.md", title: "Old" });
  const duplicate = makeNote({ path: "b.md", title: "Old" });
  const source = makeNote({ path: "source.md", content: "[[Old]]\n" });
  const snapshot = buildSnapshot([renamed, duplicate, source]);

  assert.equal(snapshot.links[0]?.targetUri, renamed.uri);
  assert.deepEqual(
    planPathLinkMigration(snapshot, renamed, "New", "z.md").map((item) => item.text),
    ["[[z]]"],
  );
});

test("rename planning never rewrites wiki-looking URL substrings", () => {
  const source = makeNote({
    path: "source.md",
    content: "[download](assets/[[Old]].pdf)\nhttps://example.test/?q=[[Old]]\n",
  });
  const target = makeNote({ path: "old.md", title: "Old" });
  const snapshot = buildSnapshot([source, target]);
  assert.equal(planLinkMigration(snapshot, target, "New", "new.md").length, 0);
});

test("migration uses an encoded path relative to each source note", () => {
  const source = {
    uri: "file:///notes/team/source.md",
    path: "notes/team/source.md",
    title: "Source",
    links: [{ raw: "[[Old]]", target: "Old", range: { start: 0, end: 7 } }],
  } as unknown as import("../../src/domain/models").NoteRecord;
  const target = {
    uri: "file:///notes/old.md",
    path: "notes/old.md",
    title: "Old",
  } as unknown as import("../../src/domain/models").NoteRecord;
  const snapshot = {
    notes: [source, target],
    links: [{ sourceUri: source.uri, targetUri: target.uri, link: source.links[0]! }],
    backlinks: [],
    tasks: [],
    skippedOversized: [],
    version: 1,
    indexedAt: 1,
  } as import("../../src/domain/models").IndexSnapshot;

  assert.equal(
    planLinkMigration(snapshot, target, "New #1", "notes/New #1.md")[0]?.text,
    "[[../New %231]]",
  );
});
