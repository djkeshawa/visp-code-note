import { requireElement } from "../shared/dom.js";
import type { GraphDetailsElements } from "./details.js";

export interface GraphPageElements {
  readonly svg: SVGSVGElement;
  readonly emptyState: HTMLElement;
  readonly graphScope: HTMLElement;
  readonly depthControl: HTMLElement;
  readonly search: HTMLInputElement;
  readonly searchStatus: HTMLElement;
  readonly orphanToggle: HTMLInputElement;
  readonly connections: HTMLElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly fitGraph: HTMLButtonElement;
  readonly centerSelected: HTMLButtonElement;
  readonly resetLayout: HTMLButtonElement;
  readonly zoomStatus: HTMLElement;
  readonly kindToggles: readonly HTMLInputElement[];
  readonly depthButtons: readonly HTMLButtonElement[];
  readonly details: GraphDetailsElements;
}

export function getGraphPageElements(): GraphPageElements {
  const connections = requireElement("#selected-connections", HTMLElement);
  const openSelected = requireElement("#open-selected", HTMLButtonElement);
  return {
    svg: requireElement("#graph-svg", SVGSVGElement),
    emptyState: requireElement("#graph-empty", HTMLElement),
    graphScope: requireElement("#graph-scope", HTMLElement),
    depthControl: requireElement("#depth-control", HTMLElement),
    search: requireElement("#graph-search", HTMLInputElement),
    searchStatus: requireElement("#graph-search-status", HTMLElement),
    orphanToggle: requireElement("#show-orphans", HTMLInputElement),
    connections,
    zoomIn: requireElement("#graph-zoom-in", HTMLButtonElement),
    zoomOut: requireElement("#graph-zoom-out", HTMLButtonElement),
    fitGraph: requireElement("#graph-fit", HTMLButtonElement),
    centerSelected: requireElement("#graph-center", HTMLButtonElement),
    resetLayout: requireElement("#graph-reset", HTMLButtonElement),
    zoomStatus: requireElement("#graph-zoom-status", HTMLElement),
    kindToggles: Array.from(document.querySelectorAll<HTMLInputElement>('input[data-kind]')),
    depthButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-depth]')),
    details: {
      title: requireElement("#selected-title", HTMLHeadingElement),
      kind: requireElement("#selected-kind", HTMLElement),
      outgoing: requireElement("#selected-outgoing", HTMLElement),
      incoming: requireElement("#selected-incoming", HTMLElement),
      neighbors: requireElement("#selected-neighbors", HTMLElement),
      connectionCount: requireElement("#selected-connection-count", HTMLElement),
      connectionList: connections,
      openButton: openSelected,
    },
  };
}
