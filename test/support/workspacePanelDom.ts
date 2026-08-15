/**
 * The real workspace panel, running.
 *
 * The panel is a webview script: it wires itself to the document as it loads, and everything it
 * does afterwards is a reply to a host message or a key press. So the only way to find out
 * whether a row can be reached from the keyboard is to draw the real markup, load the real
 * script into it, and press the key — reading the source proves nothing about where focus
 * lands, which is the whole subject.
 *
 * `installWorkspaceDom` has to run before `src/webview/workspace` is imported, because the
 * panel reaches for both the document and the host stub while it loads. That is why the two
 * harnesses beside this file exist rather than a parameter: an import cannot be given one.
 */
import { window } from "./domEnvironment";
import { WORKSPACE_BODY } from "../../src/ui/pageBodies";
import type { WorkspacePanelState } from "../../src/domain/protocol";

/** Everything the panel has asked the host to do, oldest first. */
export const posted: unknown[] = [];

/** What the panel has stashed for the next reload, as `api.setState` left it. */
export let savedState: { readonly expanded: readonly string[] } | undefined;

export function installWorkspaceDom(expanded?: readonly string[]): void {
  if (expanded !== undefined) savedState = { expanded: [...expanded] };
  window.document.body.innerHTML = WORKSPACE_BODY;
  (globalThis as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => posted.push(message),
    getState: () => savedState,
    setState: (state: unknown) => {
      savedState = state as { readonly expanded: readonly string[] };
    },
  });
}

/** Hands the panel a state the way the extension host does. */
export function publish(state: WorkspacePanelState): void {
  window.dispatchEvent(new window.MessageEvent("message", {
    data: { type: "workspace/state", state },
  }));
}

/** Answers the panel's filter query the way the host's search index does. */
export function answerFilter(query: string, uris: readonly string[] = []): void {
  window.dispatchEvent(new window.MessageEvent("message", {
    data: { type: "workspace/filterMatches", query, uris },
  }));
}

/**
 * Types into the filter and waits for the list to settle. The field is debounced and then
 * waits on the host for the notes that match by content, so a test that looks straight after
 * typing is looking at the previous query's rows.
 */
export async function typeFilter(query: string): Promise<void> {
  const filter = element<HTMLInputElement>("#workspace-filter");
  filter.value = query;
  filter.dispatchEvent(new window.Event("input"));
  await delay(160);
  if (query !== "") answerFilter(query);
  await delay(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function press(target: EventTarget, key: string): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export function element<T extends Element>(selector: string): T {
  const found = window.document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector} in the panel`);
  return found;
}

export function focused(): HTMLElement | undefined {
  const active = window.document.activeElement;
  return active instanceof window.HTMLElement && active !== window.document.body
    ? active
    : undefined;
}

/** What the focused element reads as, so an assertion can say what the reader would see. */
export function focusedText(): string | undefined {
  const active = focused();
  if (active === undefined) return undefined;
  return active instanceof window.HTMLInputElement
    ? active.getAttribute("aria-label") ?? active.id
    : (active.textContent ?? "").trim();
}

/**
 * Where Tab can go — which is what a reader finds out after acting, and what watching the list
 * change cannot tell you. jsdom implements no sequential focus navigation, so this reads the
 * tab order off the document: every enabled control that has not been taken out of it.
 */
export function tabStops(): readonly HTMLElement[] {
  return Array.from(
    window.document.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
  ).filter((candidate) => candidate.getAttribute("tabindex") !== "-1" &&
    !(candidate instanceof window.HTMLInputElement && candidate.disabled) &&
    candidate.closest("[hidden]") === null);
}

/** The rows one section is showing, as text, in the order they are drawn. */
export function rowLabels(containerId: string): readonly string[] {
  return Array.from(
    window.document.querySelectorAll<HTMLElement>(`#${containerId} .workspace-row`),
  ).map((row) => (row.textContent ?? "").trim());
}

/** How far in a row is drawn, from the property the stylesheet indents by. */
export function rowDepth(row: HTMLElement): number {
  return Number(row.style.getPropertyValue("--row-depth") || "0");
}
