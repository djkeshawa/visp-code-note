import assert = require("node:assert/strict");
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost, window } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";
import { isBareKey } from "../../src/webview/shared/rovingList";

/**
 * Which keys the extension is allowed to take, checked against the two tables that already
 * own keys on this keyboard: VS Code's defaults, and the note editor's own keymap.
 *
 * A key an extension takes from VS Code is not reported as a bug — the reader concludes the
 * editor is broken and uninstalls the newest thing they added. A key the note editor also
 * handles is worse: both things happen at once, and neither looks deliberate.
 */

interface Keybinding {
  readonly command: string;
  readonly key: string;
  readonly mac?: string;
  readonly when?: string;
}

interface ExtensionManifest {
  readonly contributes?: { readonly keybindings?: readonly Keybinding[] };
}

const manifestPath = join(__dirname, "../../../package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
const keybindings = manifest.contributes?.keybindings ?? [];

/**
 * Keys VS Code's own default table already spends, and what a reader loses if we take one.
 *
 * Read out of a shipped 1.96 install rather than from memory: every default is registered as
 * KeyMod|KeyCode arithmetic in `workbench.desktop.main.js` — Run Build Task is `primary:3104`,
 * which is CtrlCmd(2048) | Shift(1024) | KeyB(32). This is not the whole table, only the keys
 * a Markdown notes extension is tempted by, including the ones this extension has taken before.
 */
const VS_CODE_DEFAULTS: Readonly<Record<string, string>> = {
  "ctrl+shift+b": "Run Build Task",
  "ctrl+shift+l": "Select All Occurrences of Find Match",
  "ctrl+shift+f": "Find in Files",
  "ctrl+shift+g": "Source Control, and Find Previous in a terminal",
  "ctrl+shift+e": "Explorer",
  "ctrl+shift+p": "Command Palette",
  "ctrl+shift+n": "New Window",
  "ctrl+p": "Go to File",
  "ctrl+k": "the chord prefix half of VS Code's keyboard hangs off",
  "ctrl+alt+f": "Find in a list, and Replace on macOS",
  "ctrl+alt+b": "Toggle Secondary Side Bar",
  "ctrl+alt+i": "Toggle Developer Tools",
  "ctrl+alt+v": "Start Dictation",
  "shift+alt+f": "Format Document",
  "shift+alt+a": "Toggle Block Comment",
  "shift+alt+i": "Add Cursor at End of Each Line",
  "shift+alt+o": "Organize Imports",
  "shift+alt+h": "Show Call Hierarchy",
};

function conflict(binding: Keybinding): string | undefined {
  return VS_CODE_DEFAULTS[binding.key] ?? VS_CODE_DEFAULTS[macAsCtrl(binding.mac)];
}

/** `cmd` on macOS resolves against the same rules `ctrl` does on the other platforms. */
function macAsCtrl(mac: string | undefined): string {
  return (mac ?? "").replace("cmd+", "ctrl+");
}

test("a key VS Code has spent is never taken away from the whole editor", () => {
  for (const binding of keybindings) {
    const taken = conflict(binding);
    if (taken === undefined) {
      continue;
    }
    assert.ok(
      binding.when !== undefined && binding.when.length > 0,
      `${binding.command} takes ${binding.key} (${taken}) everywhere, in every file type`,
    );
  }
});

test("searching notes is on the keyboard, and not on a key VS Code was using", () => {
  const search = keybindings.filter((binding) => binding.command === "vispNotes.search");

  assert.ok(search.length > 0, "the most-used command in the extension has no key at all");
  for (const binding of search) {
    assert.equal(conflict(binding), undefined, `search took ${binding.key}`);
  }
});

/*
 * The note editor is a webview, so its own keymap sees a key first and VS Code sees it
 * regardless — a key both tables claim runs both things. Only the non-mac key is exercised:
 * `Mod-` in the editor's keymap resolves to Ctrl off macOS, so pressing Cmd here would match
 * nothing and prove nothing.
 */

/** How a binding says in the manifest that the note editor is not its window. */
const EXCLUDES_NOTE_EDITOR = "activeCustomEditorId != vispNotes.noteEditor";

/**
 * Whether pressing this binding's key in an open note would run its command.
 *
 * There used to be a hand-kept set of commands excused from the loop below, which is how Open
 * Local Graph sat on Ctrl+Shift+G — the editor's own Find Previous — for a wave: an exception
 * list records a collision rather than preventing the next one. The manifest says it itself
 * now. A binding is out of this window when its `when` clause puts it in a text editor or
 * names the note editor to exclude it; every other binding has to survive the press.
 */
function reachesNoteEditor(binding: Keybinding): boolean {
  const when = binding.when ?? "";
  return !when.includes("editorTextFocus") && !when.includes(EXCLUDES_NOTE_EDITOR);
}

const NOTE_EDITOR_KEYS = keybindings.filter(reachesNoteEditor);

interface OpenNote {
  readonly press: (key: string) => KeyboardEvent;
  readonly select: (from: number, to: number) => void;
}

const SOURCE = "# Atlas\n\nAtlas is the note about Atlas.\n";

function openNote(): OpenNote {
  const editor = new CodeMirrorEditor(createHost(), "test-nonce", SOURCE, {
    suggestions: () => [],
    workspaceTags: () => [],
    unresolvedLinks: () => new Set<string>(),
    sourcePatched: () => undefined,
    saveRequested: () => undefined,
    openLink: () => undefined,
    openExternal: () => undefined,
    noteTitle: () => "Atlas",
  });
  const view = (editor as unknown as {
    view: { contentDOM: HTMLElement; dispatch: (spec: unknown) => void };
  }).view;

  return {
    press(key) {
      const parts = key.split("+");
      const letter = parts[parts.length - 1] as string;
      const shift = parts.includes("shift");
      const event = new window.KeyboardEvent("keydown", {
        key: shift && letter.length === 1 ? letter.toUpperCase() : letter,
        code: letter.length === 1 ? `Key${letter.toUpperCase()}` : letter,
        ctrlKey: parts.includes("ctrl"),
        shiftKey: shift,
        altKey: parts.includes("alt"),
        bubbles: true,
        cancelable: true,
      });
      /*
       * jsdom leaves `keyCode` at zero, and the editor resolves a shifted letter through the
       * physical key — without this every shifted binding silently matches nothing here.
       */
      if (event.keyCode === 0) {
        Object.defineProperty(event, "keyCode", { value: letter.toUpperCase().charCodeAt(0) });
      }
      view.contentDOM.dispatchEvent(event);
      return event;
    },
    select(from, to) {
      view.dispatch({ selection: { anchor: from, head: to } });
    },
  };
}

test("the note editor leaves the extension's own keys for VS Code to route", () => {
  for (const binding of NOTE_EDITOR_KEYS) {
    const note = openNote();
    // With text selected: that is how Insert Link is used, and it is what wakes the
    // editor's own selection commands up.
    note.select(9, 14);

    const event = note.press(binding.key);
    assert.equal(
      event.defaultPrevented,
      false,
      `${binding.key} (${binding.command}) is also a note editor key, so both run`,
    );
  }
});

test("Ctrl+Shift+L is a note editor key, which is why Insert Link no longer uses it", () => {
  const note = openNote();
  note.select(9, 14);

  const event = note.press("ctrl+shift+l");
  assert.equal(
    event.defaultPrevented,
    true,
    "if the editor stopped claiming this key, the test above is no longer proving anything",
  );
});

/*
 * The graph's key, from both ends.
 *
 * Ctrl+Shift+G is the editor's Find Previous, so in a note the reader has searched it used to
 * jump the selection and open the graph at once. Insert Link's collision was fixed by moving
 * the key; this one cannot be, because every form of G the reader would guess belongs to the
 * editor's search — Mod-g is Find Next, Mod-Shift-g is Find Previous and Mod-Alt-g is Go to
 * Line, and on macOS `Mod-` is Cmd, so Cmd+Alt+G is taken too and the house pattern has
 * nowhere to put it. The binding is scoped out of this window instead, and the note editor's
 * own menu is how the command is reached from inside a note.
 *
 * Two assertions because either half alone rots quietly: an editor that stopped claiming the
 * key would leave the scoping looking necessary when it was not, and a manifest that dropped
 * the scoping would put the collision back with the press below still passing.
 */
test("Ctrl+Shift+G is a note editor key, so Open Local Graph is scoped out of the note editor", () => {
  const note = openNote();
  note.select(9, 14);

  assert.equal(
    note.press("ctrl+shift+g").defaultPrevented,
    true,
    "Find Previous stopped claiming this key, so the graph could have it back",
  );
  const graph = keybindings.filter((binding) => binding.command === "vispNotes.openLocalGraph");
  assert.ok(graph.length > 0, "the graph lost its key entirely");
  for (const binding of graph) {
    assert.ok(
      !reachesNoteEditor(binding),
      `${binding.key} runs in an open note, where the editor already answers it`,
    );
  }
});

/*
 * Go to Line, pressed in the form this keyboard can press it. `Mod-Alt-g` is one keymap entry
 * that reads as Ctrl+Alt+G here and Cmd+Alt+G on macOS, so this is how the mac half of the
 * house pattern — Cmd+Alt+ the command's letter, as Search and Insert Link use — is shown to
 * be unavailable to a command whose letter is G, without a mac to press it on.
 */
test("Ctrl+Alt+G is a note editor key, which is why Cmd+Alt+G could not be the mac binding", () => {
  const note = openNote();
  note.select(9, 14);

  assert.equal(
    note.press("ctrl+alt+g").defaultPrevented,
    true,
    "Go to Line stopped claiming this key, so the graph could follow the house pattern",
  );
});

/*
 * The panels' list keys.
 *
 * The workspace panel, the note list and the tasks view now answer Enter, the arrows, Home and
 * End so that a filtered list can be worked without a mouse. None of those is a key this
 * extension can contribute — they are keys the whole editor is already using — so the panels
 * take them only in the bare form, and only inside their own list. Every modified version
 * belongs to somebody else: Ctrl+Home and Ctrl+End scroll, and Alt+Left and Alt+Right are Go
 * Back and Go Forward, all of which fire inside a webview.
 */
const PANEL_LIST_KEYS: readonly string[] = ["Enter", "ArrowDown", "ArrowUp", "Home", "End"];

test("the panels' list keys are never contributed to the whole editor", () => {
  for (const binding of keybindings) {
    const last = binding.key.split("+").at(-1) ?? "";
    assert.ok(
      !PANEL_LIST_KEYS.some((key) => key.toLowerCase() === last.toLowerCase()),
      `${binding.command} contributes ${binding.key}, which the panels' lists answer themselves`,
    );
  }
});

test("a list leaves a modified press for whoever else is listening", () => {
  for (const key of PANEL_LIST_KEYS) {
    for (const held of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) {
      const event = new window.KeyboardEvent("keydown", { key, [held]: true });
      assert.equal(isBareKey(event), false, `${held} + ${key} was treated as a bare press`);
    }
    assert.equal(isBareKey(new window.KeyboardEvent("keydown", { key })), true);
  }
});
