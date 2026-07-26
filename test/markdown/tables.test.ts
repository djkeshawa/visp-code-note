import assert = require("node:assert/strict");
import { test } from "node:test";
import { pipePositions, tableLines } from "../../src/markdown/tables";

function classify(source: string): readonly string[] {
  const lines = source.split("\n");
  return tableLines(lines).map((entry) => `${entry.line} ${entry.kind}`);
}

test("classifies a header, its delimiter, and every body row", () => {
  const source = [
    "| Column A | Column B |",
    "| --- | --- |",
    "| one | two |",
    "| three | four |",
  ].join("\n");

  assert.deepEqual(classify(source), ["0 header", "1 delimiter", "2 body", "3 body"]);
});

test("stops at the blank line that ends the table", () => {
  const source = ["| A |", "| - |", "| x |", "", "Prose after."].join("\n");

  assert.deepEqual(classify(source), ["0 header", "1 delimiter", "2 body"]);
});

test("accepts alignment markers and tables without outer pipes", () => {
  const aligned = ["| L | C | R |", "|:--- | :-: | ---:|", "| a | b | c |"].join("\n");
  assert.deepEqual(classify(aligned), ["0 header", "1 delimiter", "2 body"]);

  const bare = ["A | B", "--- | ---", "x | y"].join("\n");
  assert.deepEqual(classify(bare), ["0 header", "1 delimiter", "2 body"]);
});

test("a row without a delimiter beneath it is not a table", () => {
  // Prose containing a pipe must not be mistaken for a table.
  assert.deepEqual(classify(["A pipe | in prose.", "More prose."].join("\n")), []);
  assert.deepEqual(classify(["| looks like a row |", "but no delimiter"].join("\n")), []);
});

test("ignores a table drawn inside fenced code", () => {
  const source = [
    "```md",
    "| A |",
    "| - |",
    "| x |",
    "```",
    "| Real |",
    "| ---- |",
    "| yes |",
  ].join("\n");

  assert.deepEqual(classify(source), ["5 header", "6 delimiter", "7 body"]);
});

test("finds two tables separated by prose", () => {
  const source = [
    "| A |", "| - |", "| 1 |",
    "",
    "Between.",
    "",
    "| B |", "| - |", "| 2 |",
  ].join("\n");

  assert.deepEqual(
    classify(source),
    ["0 header", "1 delimiter", "2 body", "6 header", "7 delimiter", "8 body"],
  );
});

test("a delimiter row alone is not a header", () => {
  assert.deepEqual(classify(["| --- | --- |", "| a | b |"].join("\n")), []);
});

test("locates pipes and leaves escaped ones alone", () => {
  assert.deepEqual(pipePositions("| a | b |"), [0, 4, 8]);
  assert.deepEqual(pipePositions("a | b"), [2]);
  assert.deepEqual(pipePositions("| a \\| b |"), [0, 9]);
  assert.deepEqual(pipePositions("no pipes here"), []);
});

test("an empty document yields nothing", () => {
  assert.deepEqual(tableLines([]), []);
  assert.deepEqual(tableLines(["", ""]), []);
});
