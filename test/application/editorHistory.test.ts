import assert = require("node:assert/strict");
import { test } from "node:test";
import { EditorState, Transaction } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { hostSourceChange } from "../../src/webview/editor/hostSourceChange";

/**
 * What undo has to do in a note editor, written as the reader would state it.
 *
 * These are deliberately not derived from how the editor is wired. Each one is a sentence a
 * reader would say about their own keyboard — "I typed something and Ctrl+Z put it back" —
 * turned into an assertion. Where the editor fails one, the behaviour is wrong, whatever the
 * implementation happens to do.
 *
 * The undo history is a property of the editor's state rather than of its view, so all of
 * this runs without a DOM: `undo` and `redo` are state commands.
 */

/**
 * A note being edited. `type` is the reader at the keyboard; `hostEcho` is the editor being
 * told what the file now holds, which happens constantly while a note is open — every edit is
 * sent to the host, written to the document, and confirmed back.
 */
class OpenNote {
  public state: EditorState;
  /*
   * Editors group keystrokes that arrive together into one undo step, which is why holding a
   * key does not cost fifty presses of Ctrl+Z. Each `type` here is a separate act of writing
   * with a pause before it, so each is its own step — that is what a reader means by "one
   * edit", and testing it any other way tests the grouping timer rather than undo.
   */
  private clock = Date.now();

  public constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [history()] });
  }

  public get text(): string {
    return this.state.doc.toString();
  }

  public type(from: number, to: number, insert: string): void {
    this.clock += 5_000;
    this.state = this.state.update({
      changes: { from, to, insert },
      userEvent: "input.type",
      annotations: Transaction.time.of(this.clock),
    }).state;
  }

  /**
   * The host confirming the note's text. It is not the reader's edit, so it is not its own
   * undo step — but it must not cost the reader the steps they already have.
   *
   * How the editor applies the confirmation is its own business; what matters is only that
   * afterwards the document reads as the host says and the reader's history is intact.
   */
  public hostEcho(source: string): void {
    const changes = hostSourceChange(this.text, source);
    if (changes === undefined) return;
    this.clock += 1;
    this.state = this.state.update({
      changes,
      annotations: [Transaction.addToHistory.of(false), Transaction.time.of(this.clock)],
    }).state;
  }

  public undo(): boolean {
    return undo({ state: this.state, dispatch: (tr) => { this.state = tr.state; } });
  }

  public redo(): boolean {
    return redo({ state: this.state, dispatch: (tr) => { this.state = tr.state; } });
  }
}

const TABLE = ["| Name | Tag |", "| --- | --- |", "| Ada | research |"].join("\n");

test("typing something and undoing puts the note back the way it was", () => {
  const note = new OpenNote("# Atlas\n\n");
  note.type(9, 9, "A first sentence.");
  assert.equal(note.text, "# Atlas\n\nA first sentence.");

  assert.equal(note.undo(), true, "there was something to undo");
  assert.equal(note.text, "# Atlas\n\n");
});

test("redo brings back what undo took away", () => {
  const note = new OpenNote("# Atlas\n\n");
  note.type(9, 9, "A first sentence.");
  note.undo();

  assert.equal(note.redo(), true);
  assert.equal(note.text, "# Atlas\n\nA first sentence.");
});

test("a table inserted in one action is removed by one undo, not line by line", () => {
  const note = new OpenNote("# Atlas\n\n");
  note.type(9, 9, TABLE);
  assert.equal(note.text.includes("| Ada | research |"), true);

  note.undo();
  assert.equal(note.text, "# Atlas\n\n", "the whole table goes at once");
});

test("separate edits undo one at a time, newest first", () => {
  const note = new OpenNote("");
  note.type(0, 0, "one");
  note.type(3, 3, " two");
  note.type(7, 7, " three");
  assert.equal(note.text, "one two three");

  note.undo();
  assert.equal(note.text, "one two");
  note.undo();
  assert.equal(note.text, "one");
});

/*
 * The one a reader actually hits. An edit is sent to the host and confirmed back before the
 * next keystroke, so by the time Ctrl+Z is pressed the confirmation has already arrived. If
 * that confirmation costs the reader their history, undo does nothing on a note being typed
 * into — which is every note.
 */
test("undo still works after the host confirms the same text back", () => {
  const note = new OpenNote("# Atlas\n\n");
  note.type(9, 9, TABLE);
  const afterTyping = note.text;

  note.hostEcho(afterTyping);

  assert.equal(note.undo(), true, "the reader's own edit is still undoable");
  assert.equal(note.text, "# Atlas\n\n");
});

/*
 * The host does not always echo back exactly what was typed — it may normalise line endings
 * or apply a formatter on save. The reader's earlier edits must survive that too.
 */
test("undo still works after the host confirms back a normalised version of the text", () => {
  const note = new OpenNote("# Atlas\n\n");
  note.type(9, 9, "A sentence with a trailing space \n");
  note.hostEcho("# Atlas\n\nA sentence with a trailing space\n");

  assert.equal(note.undo(), true, "the reader can still step back past their own edit");
  assert.equal(note.text.startsWith("# Atlas"), true);
});

test("undo reports there is nothing to undo on an untouched note", () => {
  const note = new OpenNote("# Atlas\n");
  assert.equal(note.undo(), false);
  assert.equal(note.text, "# Atlas\n");
});
