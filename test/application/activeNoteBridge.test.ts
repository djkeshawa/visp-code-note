import assert = require("node:assert/strict");
import { test } from "node:test";
import { parseActiveNoteEntry, pickActiveNote, processIsRunning } from "../../src/application/activeNoteBridge";

const running = new Set([10, 20]);
const isRunning = (pid: number) => running.has(pid);

test("the newest note from a running window, inside the served folder, wins", () => {
  const entries = [
    { file: "/work/notes/old.md", at: 1, pid: 10 },
    { file: "/work/notes/new.md", at: 3, pid: 20 },
    { file: "/work/notes/ghost.md", at: 9, pid: 99 },
    { file: "/elsewhere/other.md", at: 8, pid: 10 },
  ];
  assert.equal(pickActiveNote(entries, "/work", isRunning)?.file, "/work/notes/new.md");
  assert.equal(pickActiveNote(entries, "/nowhere", isRunning), undefined);
});

test("a folder is not inside a sibling that shares its name as a prefix", () => {
  assert.equal(pickActiveNote([{ file: "/work-old/a.md", at: 1, pid: 10 }], "/work", isRunning), undefined);
});

test("only a well-formed entry with an absolute path is believed", () => {
  assert.deepEqual(parseActiveNoteEntry('{"file":"/a/b.md","at":5,"pid":7}'), { file: "/a/b.md", at: 5, pid: 7 });
  for (const text of ["", "null", '{"file":"b.md","at":5,"pid":7}', '{"file":"/b.md","at":"5","pid":7}', '{"file":"/b.md","at":5,"pid":-1}']) {
    assert.equal(parseActiveNoteEntry(text), undefined, text);
  }
});

test("this process is running, and a pid nobody has is not", () => {
  assert.equal(processIsRunning(process.pid), true);
  assert.equal(processIsRunning(2 ** 22 + 12345), false);
});
