import { pickedCompletion, startCompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { isProtectedMarkdownPosition } from "./markdownContext.js";
import {
  expandSlashCommand,
  findSlashQuery,
  localDateKey,
  rankSlashCommands,
} from "./slashCommands.js";

/**
 * The `/` menu as a completion source, alongside the wiki-link one.
 *
 * Shaped like `wikiCompletion` on purpose: same guard against fenced code and frontmatter, same
 * `filter: false` because the ranking here is the ranking, and the same `apply` that dispatches
 * the change itself so the caret can land somewhere other than the end of what was inserted —
 * inside `@due(…)`, or on the first line of a fenced block.
 */
export function createSlashCompletionSource(now: () => Date = () => new Date()): CompletionSource {
  return (context) => slashCompletions(context, now());
}

export function slashCompletions(
  context: CompletionContext,
  now: Date,
): CompletionResult | null {
  const query = slashQueryAt(context.state, context.pos);
  if (query === undefined || isProtectedMarkdownPosition(context.state, context.pos)) return null;

  const today = localDateKey(now);
  const options = rankSlashCommands(query.query).map((command): Completion => ({
    label: command.label,
    detail: command.detail,
    // The codicon rides in `type`; see `completionIcon` in codeMirrorEditor.
    type: `visp-${command.icon}`,
    apply: (view, completion, from, to) => {
      const insertion = expandSlashCommand(command, today);
      view.dispatch({
        changes: { from, to, insert: insertion.text },
        /*
         * A placeholder arrives selected so that typing replaces it. Anchoring at the end and
         * heading back to the start leaves the caret where the reader is looking.
         */
        selection: insertion.selectionEnd === undefined
          ? { anchor: from + insertion.caret }
          : { anchor: from + insertion.selectionEnd, head: from + insertion.caret },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
      // `[[` is only half the action; the note picker is the other half.
      if (command.opensCompletion === true) startCompletion(view);
    },
  }));

  const line = context.state.doc.lineAt(context.pos);
  return { from: line.from + query.start, to: context.pos, options, filter: false };
}

/**
 * The `/…` the caret sits in, if any.
 *
 * Exported because the popup's own chrome depends on it: the wiki-link footer names `#`, `^`
 * and `|`, which mean nothing to a block command, so the tooltip has to know which source it
 * is showing.
 */
export function slashQueryAt(state: EditorState, position: number): ReturnType<typeof findSlashQuery> {
  const line = state.doc.lineAt(position);
  return findSlashQuery(state.sliceDoc(line.from, position));
}
