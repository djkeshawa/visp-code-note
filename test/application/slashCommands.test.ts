import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  SLASH_COMMANDS,
  expandSlashCommand,
  findSlashQuery,
  localDateKey,
  rankSlashCommands,
} from "../../src/webview/editor/slashCommands";

function commandById(id: string) {
  const command = SLASH_COMMANDS.find((candidate) => candidate.id === id);
  assert.notEqual(command, undefined, `no such command: ${id}`);
  return command!;
}

test("a slash opens a menu where a block can start", () => {
  assert.deepEqual(findSlashQuery("/"), { start: 0, query: "" });
  assert.deepEqual(findSlashQuery("/tab"), { start: 0, query: "tab" });
  assert.deepEqual(findSlashQuery("  /code"), { start: 2, query: "code" });
  assert.deepEqual(findSlashQuery("- /task"), { start: 2, query: "task" });
  assert.deepEqual(findSlashQuery("1. /quote"), { start: 3, query: "quote" });
  assert.deepEqual(findSlashQuery("- [ ] /due"), { start: 6, query: "due" });
});

test("a slash inside prose is punctuation, not a command", () => {
  assert.equal(findSlashQuery("and/or"), undefined);
  assert.equal(findSlashQuery("see https://example.com"), undefined);
  assert.equal(findSlashQuery("due 12/08"), undefined);
  assert.equal(findSlashQuery("Some text /table"), undefined, "a slash mid-sentence");
  assert.equal(findSlashQuery("> /quote"), undefined, "a blockquote already is one");
  assert.equal(findSlashQuery("no slash here"), undefined);
});

test("a query with a space in it has stopped being a command", () => {
  assert.equal(findSlashQuery("/code block"), undefined);
  assert.deepEqual(findSlashQuery("/heading-1"), { start: 0, query: "heading-1" });
});

test("an empty query offers every command in the declared order", () => {
  assert.deepEqual(rankSlashCommands(""), SLASH_COMMANDS);
  assert.deepEqual(rankSlashCommands("   "), SLASH_COMMANDS);
});

test("commands tied on a label prefix keep the order the list declares", () => {
  assert.deepEqual(
    rankSlashCommands("ta").slice(0, 3).map((command) => command.id),
    ["task", "table", "tag"],
    "all three labels start with the query, so nothing but the declared order can decide",
  );
});

test("a label prefix outranks a keyword match", () => {
  const ranked = rankSlashCommands("d").map((command) => command.id);
  assert.deepEqual(ranked.slice(0, 2), ["due", "divider"], "both labels start with the query");
  assert.ok(
    ranked.indexOf("today") > ranked.indexOf("due"),
    "Today's Date is reachable only through its “date” keyword, so it ranks below",
  );
});

test("a command can be found by a word that is not in its label", () => {
  assert.equal(rankSlashCommands("todo")[0]?.id, "task");
  assert.equal(rankSlashCommands("deadline")[0]?.id, "due");
  assert.equal(rankSlashCommands("admonition")[0]?.id, "callout");
  assert.deepEqual(rankSlashCommands("nothing matches this"), []);
});

test("a template expands to text with the caret where the reader keeps typing", () => {
  assert.deepEqual(expandSlashCommand(commandById("task"), "2026-08-15"), {
    text: "- [ ] ",
    caret: 6,
  });
  assert.deepEqual(expandSlashCommand(commandById("heading-2"), "2026-08-15"), {
    text: "## ",
    caret: 3,
  });
  assert.deepEqual(expandSlashCommand(commandById("quote"), "2026-08-15"), {
    text: "> ",
    caret: 2,
  });
});

test("today's date is filled in, and the caret follows it", () => {
  assert.deepEqual(expandSlashCommand(commandById("today"), "2026-08-15"), {
    text: "2026-08-15",
    caret: 10,
  });
  assert.deepEqual(expandSlashCommand(commandById("due"), "2026-08-15"), {
    text: "@due(2026-08-15)",
    caret: 15,
  }, "inside the parentheses, so a time can be typed straight after the date");
});

test("a multi-line block lands the caret on the line the reader edits first", () => {
  const code = expandSlashCommand(commandById("code"), "2026-08-15");
  assert.equal(code.text, "```\n\n```");
  assert.equal(code.caret, 3, "after the opening fence, where the language goes");

  const callout = expandSlashCommand(commandById("callout"), "2026-08-15");
  assert.equal(callout.text, "> [!NOTE]\n> ");
  assert.equal(callout.caret, callout.text.length);

  const table = expandSlashCommand(commandById("table"), "2026-08-15");
  assert.equal(table.text.split("\n").length, 3);
  assert.equal(table.caret, 2, "on the first column heading");
  assert.equal(table.selectionEnd, 8, "which arrives selected");
});

test("a template with no caret marker leaves the caret at the end", () => {
  assert.deepEqual(expandSlashCommand(commandById("divider"), "2026-08-15"), {
    text: "---\n",
    caret: 4,
  });
});

test("no expansion leaks a marker character", () => {
  for (const command of SLASH_COMMANDS) {
    const { text } = expandSlashCommand(command, "2026-08-15");
    // Both markers are control characters, so a leak would be invisible in a diff.
    for (const marker of ["\u0000", "\u0001"]) {
      assert.equal(text.includes(marker), false, `${command.id} leaked a marker`);
    }
  }
});

test("every command is uniquely identified and drawn", () => {
  const ids = new Set(SLASH_COMMANDS.map((command) => command.id));
  assert.equal(ids.size, SLASH_COMMANDS.length);
  for (const command of SLASH_COMMANDS) {
    assert.notEqual(command.icon, "", `${command.id} has no icon`);
    assert.notEqual(command.detail, "", `${command.id} does not say what it writes`);
  }
});

test("today is the reader's own date, not UTC's", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(localDateKey(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});

/*
 * The bug this guards: a sample value with the caret parked in front of it. `@remind(|15m)`
 * became `@remind(1m15m)` the moment the reader typed what they actually meant.
 */
test("a sample value arrives selected, so typing replaces it", () => {
  const remind = expandSlashCommand(commandById("remind"), "2026-08-15");
  assert.equal(remind.text, "@remind(15m)");
  assert.equal(remind.text.slice(remind.caret, remind.selectionEnd), "15m");

  const priority = expandSlashCommand(commandById("priority"), "2026-08-15");
  assert.equal(priority.text, "@priority(high)");
  assert.equal(priority.text.slice(priority.caret, priority.selectionEnd), "high");

  const table = expandSlashCommand(commandById("table"), "2026-08-15");
  assert.equal(table.text.slice(table.caret, table.selectionEnd), "Column");
});

test("a command that places a plain caret selects nothing", () => {
  for (const id of ["task", "heading-1", "quote", "code", "due", "today", "divider"]) {
    assert.equal(
      expandSlashCommand(commandById(id), "2026-08-15").selectionEnd,
      undefined,
      `${id} should place a caret, not a selection`,
    );
  }
});
