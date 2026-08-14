/**
 * The real note list, running — the panel behind Orphan Notes, Broken Links, a tag, and the
 * recent list. Same reasoning as the workspace panel's harness: where focus lands after a key
 * press is not something source code can be read for, and whether the panel's own validator
 * accepts a listing kind is not something the type checker can answer.
 *
 * Importing this installs the document and the host stub, so it must come before
 * `src/webview/notes`.
 */
import { window } from "./domEnvironment";
import { NOTES_BODY } from "../../src/ui/pageBodies";
import type { NotesState } from "../../src/domain/protocol";

export const posted: unknown[] = [];

window.document.body.innerHTML = NOTES_BODY;
(globalThis as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => posted.push(message),
  getState: () => undefined,
  setState: () => undefined,
});

export function publish(state: NotesState): void {
  window.dispatchEvent(new window.MessageEvent("message", {
    data: { type: "notes/state", state },
  }));
}

export function press(target: EventTarget, key: string): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export function search(): HTMLInputElement {
  const input = window.document.querySelector<HTMLInputElement>("#note-search");
  if (input === null) throw new Error("no filter field in the note list");
  return input;
}

export function type(query: string): void {
  const input = search();
  input.value = query;
  input.dispatchEvent(new window.Event("input"));
}

export function rows(): readonly HTMLElement[] {
  return Array.from(window.document.querySelectorAll<HTMLElement>("#note-rows .note-row"));
}

export function focused(): HTMLElement | undefined {
  const active = window.document.activeElement;
  return active instanceof window.HTMLElement && active !== window.document.body
    ? active
    : undefined;
}

/** Where Tab can go inside the list — one stop, or one per row, which is the whole question. */
export function listTabStops(): readonly HTMLElement[] {
  return rows().filter((row) => row.getAttribute("tabindex") !== "-1");
}

export function text(selector: string): string {
  return (window.document.querySelector(selector)?.textContent ?? "").trim();
}
