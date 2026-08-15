/**
 * A browser for the editor to run in.
 *
 * CodeMirror is a view as much as a state machine, and the parts of it worth testing here —
 * which key does what — only exist once there is a document, an element to attach to and a
 * keydown to dispatch. jsdom supplies the document; the rest of this file supplies the
 * handful of layout APIs jsdom does not implement and CodeMirror expects to find.
 *
 * Importing this module installs the globals as a side effect, so it must be imported before
 * anything that reaches for `window` or `navigator` while it is being loaded — which
 * `@codemirror/view` does, to work out which browser it is on.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://visp.test/",
});

const { window } = dom;
const globals = globalThis as unknown as Record<string, unknown>;

/*
 * Layout, faked. jsdom parses and builds a tree but never lays anything out, so every
 * rectangle is empty and `Range.getClientRects` returns nothing. CodeMirror asks for these
 * while measuring its viewport; it copes with implausible answers but not with missing
 * methods. Nothing here is asked to be accurate — these tests read the document, not pixels.
 */
const DomRectConstructor = window.DOMRect as unknown as typeof DOMRect;
const rect = (): DOMRect => new DomRectConstructor(0, 0, 800, 600);
const emptyRectList = Object.assign([] as DOMRect[], {
  item: (): DOMRect | null => null,
}) as unknown as DOMRectList;

window.Element.prototype.getBoundingClientRect = rect;
window.Range.prototype.getBoundingClientRect = rect;
window.Range.prototype.getClientRects = (): DOMRectList => emptyRectList;

class ObserverStub {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
  public takeRecords(): readonly unknown[] {
    return [];
  }
}

for (const name of ["ResizeObserver", "IntersectionObserver"]) {
  if ((window as unknown as Record<string, unknown>)[name] === undefined) {
    (window as unknown as Record<string, unknown>)[name] = ObserverStub;
  }
}

for (const name of [
  "window", "document", "navigator", "Window", "DOMRect", "DOMRectList", "Node", "Element",
  "HTMLElement", "HTMLInputElement", "HTMLSpanElement", "HTMLDivElement", "Range",
  "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "CustomEvent", "MutationObserver",
  "ResizeObserver", "IntersectionObserver", "requestAnimationFrame", "cancelAnimationFrame",
  "DocumentFragment", "Selection", "DOMParser",
  /*
   * The panels reach for these while wiring themselves up — `requireElement` names the
   * constructor it expects, and the roving lists build keyboard events. A missing global here
   * is a ReferenceError at import time, so a panel driven by a test cannot even load.
   */
  "HTMLButtonElement", "HTMLSelectElement", "HTMLHeadingElement", "MessageEvent", "CSS",
]) {
  const value = (window as unknown as Record<string, unknown>)[name];
  if (value !== undefined && globals[name] === undefined) {
    globals[name] = typeof value === "function" && name.startsWith("request")
      ? (value as (...args: unknown[]) => unknown).bind(window)
      : value;
  }
}

globals.getComputedStyle = window.getComputedStyle.bind(window);

export { window };

/** An element attached to the document, which CodeMirror requires to mount. */
export function createHost(): HTMLElement {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  return host;
}
