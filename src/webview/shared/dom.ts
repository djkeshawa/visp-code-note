const svgNamespace = "http://www.w3.org/2000/svg";

type ElementConstructor<T extends Element> = new (...args: never[]) => T;

export function requireElement<T extends Element>(
  selector: string,
  constructor: ElementConstructor<T>,
  root: ParentNode = document,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Expected ${selector} to be a ${constructor.name}`);
  }
  return element;
}

export function htmlElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tagName: K,
  attributes: Readonly<Record<string, string>> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(svgNamespace, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function setNotice(element: HTMLElement, message?: string): void {
  element.textContent = message ?? "";
  element.hidden = message === undefined;
}
