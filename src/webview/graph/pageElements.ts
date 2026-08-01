import { requireElement } from "../shared/dom.js";
import type { GraphDetailsElements } from "./details.js";

export interface GraphPageElements {
  readonly svg: SVGSVGElement;
  readonly emptyState: HTMLElement;
  readonly summary: HTMLElement;
  readonly depthControl: HTMLElement;
  readonly search: HTMLInputElement;
  readonly searchStatus: HTMLElement;
  readonly orphanToggle: HTMLButtonElement;
  readonly connections: HTMLElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly fitGraph: HTMLButtonElement;
  readonly centerSelected: HTMLButtonElement;
  readonly resetLayout: HTMLButtonElement;
  readonly zoomStatus: HTMLElement;
  readonly kindToggles: readonly HTMLButtonElement[];
  readonly depthButtons: readonly HTMLButtonElement[];
  readonly chipCounts: readonly HTMLElement[];
  readonly menu: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  readonly menuItems: readonly HTMLButtonElement[];
  readonly details: GraphDetailsElements;
}

export function getGraphPageElements(): GraphPageElements {
  const connections = requireElement("#selected-connections", HTMLElement);
  return {
    svg: requireElement("#graph-svg", SVGSVGElement),
    emptyState: requireElement("#graph-empty", HTMLElement),
    summary: requireElement("#graph-summary", HTMLElement),
    depthControl: requireElement("#depth-control", HTMLElement),
    search: requireElement("#graph-search", HTMLInputElement),
    searchStatus: requireElement("#graph-search-status", HTMLElement),
    orphanToggle: requireElement("#show-orphans", HTMLButtonElement),
    connections,
    zoomIn: requireElement("#graph-zoom-in", HTMLButtonElement),
    zoomOut: requireElement("#graph-zoom-out", HTMLButtonElement),
    fitGraph: requireElement("#graph-fit", HTMLButtonElement),
    centerSelected: requireElement("#graph-center", HTMLButtonElement),
    resetLayout: requireElement("#graph-reset", HTMLButtonElement),
    zoomStatus: requireElement("#graph-zoom-status", HTMLElement),
    kindToggles: Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-kind]")),
    depthButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-depth]")),
    chipCounts: Array.from(document.querySelectorAll<HTMLElement>("[data-count]")),
    menu: requireElement("#graph-menu", HTMLElement),
    menuButton: requireElement("#graph-menu-button", HTMLButtonElement),
    menuItems: Array.from(
      document.querySelectorAll<HTMLButtonElement>("#graph-menu button[data-command]"),
    ),
    details: {
      card: requireElement("#graph-details", HTMLElement),
      dot: requireElement("#selected-dot", HTMLElement),
      title: requireElement("#selected-title", HTMLHeadingElement),
      outgoing: requireElement("#selected-outgoing", HTMLElement),
      incoming: requireElement("#selected-incoming", HTMLElement),
      neighbors: requireElement("#selected-neighbors", HTMLElement),
      connectionCount: requireElement("#selected-connection-count", HTMLElement),
      connectionList: connections,
      closeButton: requireElement("#graph-details-close", HTMLButtonElement),
      openButton: requireElement("#open-selected", HTMLButtonElement),
    },
  };
}
