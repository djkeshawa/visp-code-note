/**
 * Callout headers use the widely supported `> [!note] Optional title` blockquote
 * convention. Parsing stays line-local and offset-exact so live presentation can hide
 * the marker without touching the Markdown underneath.
 */

export type CalloutTone = "note" | "tip" | "important" | "warning" | "danger" | "success";

export interface CalloutHeader {
  /** The type as written, lowercased. */
  readonly kind: string;
  /** The palette the type maps onto. */
  readonly tone: CalloutTone;
  /** Codicon class name for the tone. */
  readonly icon: string;
  /** Text after the marker, if the author supplied a title. */
  readonly title: string;
  /** Offsets of `[!kind]` (plus any fold marker) within the line. */
  readonly markerStart: number;
  readonly markerEnd: number;
}

const HEADER = /^(\s{0,3}>[ \t]?)(\[!([A-Za-z][\w-]*)\]([+-]?))[ \t]*(.*)$/;

const TONES: Readonly<Record<string, CalloutTone>> = {
  note: "note",
  info: "note",
  abstract: "note",
  summary: "note",
  quote: "note",
  cite: "note",
  example: "note",
  tip: "tip",
  hint: "tip",
  question: "tip",
  help: "tip",
  faq: "tip",
  todo: "important",
  important: "important",
  attention: "warning",
  warning: "warning",
  caution: "warning",
  bug: "danger",
  danger: "danger",
  error: "danger",
  failure: "danger",
  fail: "danger",
  missing: "danger",
  success: "success",
  check: "success",
  done: "success",
};

const ICONS: Readonly<Record<CalloutTone, string>> = {
  note: "codicon-info",
  tip: "codicon-lightbulb",
  important: "codicon-star-full",
  warning: "codicon-warning",
  danger: "codicon-flame",
  success: "codicon-pass",
};

export function parseCalloutHeader(line: string): CalloutHeader | undefined {
  const match = HEADER.exec(line);
  const prefix = match?.[1];
  const marker = match?.[2];
  const kindText = match?.[3];
  if (match === null || prefix === undefined || marker === undefined || kindText === undefined) {
    return undefined;
  }
  const kind = kindText.toLocaleLowerCase();
  const tone = TONES[kind] ?? "note";
  return {
    kind,
    tone,
    icon: ICONS[tone],
    title: match[5] ?? "",
    markerStart: prefix.length,
    markerEnd: prefix.length + marker.length,
  };
}

/** The header only counts when it opens the blockquote, so callers pass the block source. */
export function parseCalloutBlock(source: string): CalloutHeader | undefined {
  const firstLine = source.split(/\r\n|\r|\n/, 1)[0];
  return firstLine === undefined ? undefined : parseCalloutHeader(firstLine);
}
