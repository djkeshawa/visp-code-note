/**
 * The real tasks view, running. Importing this installs the document and the host stub, so it
 * must come before `src/webview/tasks`.
 */
import { window } from "./domEnvironment";
import { TASKS_BODY } from "../../src/ui/pageBodies";
import type { TasksState } from "../../src/domain/protocol";

export const posted: unknown[] = [];

window.document.body.innerHTML = TASKS_BODY;
(globalThis as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => posted.push(message),
  getState: () => undefined,
  setState: () => undefined,
});

export function publish(snapshot: TasksState): void {
  window.dispatchEvent(new window.MessageEvent("message", {
    data: { type: "tasks/state", snapshot },
  }));
}

export function press(target: EventTarget, key: string): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export function search(): HTMLInputElement {
  const input = window.document.querySelector<HTMLInputElement>("#task-search");
  if (input === null) throw new Error("no filter field in the tasks view");
  return input;
}

export function type(query: string): void {
  const input = search();
  input.value = query;
  input.dispatchEvent(new window.Event("input"));
}

export function rows(): readonly HTMLElement[] {
  return Array.from(window.document.querySelectorAll<HTMLElement>("#task-groups .task-row"));
}

/** Every control inside the list that Tab can still reach. */
export function listTabStops(): readonly HTMLElement[] {
  return Array.from(
    window.document.querySelectorAll<HTMLElement>("#task-groups input, #task-groups button"),
  ).filter((control) => control.getAttribute("tabindex") !== "-1");
}

export function focused(): HTMLElement | undefined {
  const active = window.document.activeElement;
  return active instanceof window.HTMLElement && active !== window.document.body
    ? active
    : undefined;
}
