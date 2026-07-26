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

/**
 * A Codicon glyph. Decorative by default: list rows and chips pair the icon with text, so
 * announcing the icon as well would just repeat the label.
 */
export function codicon(name: string, label?: string): HTMLSpanElement {
  const glyph = htmlElement("span", `codicon codicon-${name}`);
  if (label === undefined) {
    glyph.setAttribute("aria-hidden", "true");
  } else {
    glyph.setAttribute("role", "img");
    glyph.setAttribute("aria-label", label);
  }
  return glyph;
}

/** An icon and count, used wherever a view reports how connected something is. */
export function statChip(
  icon: string,
  count: number,
  singular: string,
  plural: string,
): HTMLSpanElement {
  const chip = htmlElement("span", "stat-chip");
  chip.title = `${count} ${count === 1 ? singular : plural}`;
  chip.setAttribute("aria-label", chip.title);
  chip.append(codicon(icon), htmlElement("span", undefined, String(count)));
  return chip;
}

/**
 * An empty state with an icon and an optional next step. A bare sentence in the middle of a
 * blank panel reads as something having gone wrong; naming the reason and the way out does
 * not.
 */
export function emptyState(icon: string, message: string, hint?: string): HTMLElement {
  const container = htmlElement("div", "empty-state");
  container.append(codicon(icon), htmlElement("p", "empty-state-message", message));
  if (hint !== undefined) {
    container.append(htmlElement("p", "empty-state-hint", hint));
  }
  return container;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function setNotice(element: HTMLElement, message?: string): void {
  element.textContent = message ?? "";
  element.hidden = message === undefined;
}
