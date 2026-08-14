import assert = require("node:assert/strict");
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// Must come first: it installs the globals `@codemirror/view` reads while loading.
import { createHost, window } from "../support/domEnvironment";
import { CodeMirrorEditor } from "../../src/webview/editor/codeMirrorEditor";

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
/**
 * Open Local Graph is knowingly still on Ctrl+Shift+G, which the note editor also reads as
 * Find Previous — in a note the reader has searched, that key jumps the selection and opens
 * the graph at once. Naming it here rather than narrowing the loop keeps the next key that
 * lands from slipping in unnoticed, and leaves the graph's keys to whoever owns them.
 */
const KNOWN_DOUBLE_BOUND = new Set(["vispNotes.openLocalGraph"]);

const NOTE_EDITOR_KEYS = keybindings.filter(
  (binding) =>
    !KNOWN_DOUBLE_BOUND.has(binding.command) &&
    (binding.when === undefined || !binding.when.includes("editorTextFocus")),
);

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
