import assert = require("node:assert/strict");
import { test } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { wikiCompletions } from "../../src/webview/editor/wikiCompletion";

test("offers wiki completion in prose but not inside protected Markdown", () => {
  const prose = state("Link to [[arch");
  const code = state("`[[arch`");
  const suggestion = {
    label: "Architecture",
    target: "Architecture",
    path: "notes/architecture.md",
    aliases: [],
    referenceTarget: "Architecture",
    headings: [],
    blockIds: [],
  };

  const result = wikiCompletions(
    new CompletionContext(prose, prose.doc.length, false),
    [suggestion],
  );
  assert.equal(result?.options[0]?.label, "Architecture");
  assert.equal(
    wikiCompletions(new CompletionContext(code, code.doc.length - 1, false), [suggestion]),
    null,
  );
});

function state(source: string): EditorState {
  return EditorState.create({ doc: source, extensions: [markdown()] });
}
