import { window } from "./domEnvironment";
import "./webviewFocus";
import { GRAPH_BODY } from "../../src/ui/pageBodies";

window.document.body.innerHTML = GRAPH_BODY;
(globalThis as unknown as Record<string, unknown>).SVGSVGElement = window.SVGSVGElement;
window.SVGSVGElement.prototype.getScreenCTM = () => null;
window.matchMedia = (query: string) => ({ matches: true, media: query,
  onchange: null, addListener() {}, removeListener() {}, addEventListener() {},
  removeEventListener() {}, dispatchEvent: () => true });
(globalThis as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
  getState: () => undefined, setState: () => {}, postMessage: () => {},
});

let revision = 0;
export function publish(): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: {
    type: "graph/state", revision: ++revision, depth: 1, local: false,
    graph: { nodes: [
      { id: "a", kind: "note", label: "Alpha", uri: "file:///a.md" },
      { id: "b", kind: "note", label: "Beta", uri: "file:///b.md" },
    ], edges: [{ id: "ab", source: "a", target: "b", kind: "link" }] },
  } }));
}

export function node(id = "a"): SVGGElement {
  const element = document.querySelector<SVGGElement>(`.graph-node[data-node-id="${id}"]`);
  if (element === null) throw new Error("Graph node not rendered");
  return element;
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
