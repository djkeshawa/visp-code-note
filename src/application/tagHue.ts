/**
 * Which of the prose hues a tag is drawn in.
 *
 * A tag has no colour of its own, but it needs the same one everywhere it appears — the
 * sidebar chip, the note header, the task row — or the colour stops meaning anything. So it
 * is derived from the name rather than stored: the same tag is the same hue in every view,
 * in every workspace, with nothing to keep in sync.
 *
 * Case and a leading `#` are not part of the identity, because `#Writing` and `writing` are
 * the same tag everywhere else in this codebase.
 */
export const TAG_HUES = [
  "structure",
  "reference",
  "string",
  "declare",
  "literal",
  "accentuate",
] as const;

export type TagHue = (typeof TAG_HUES)[number];

export function tagHue(name: string): TagHue {
  const key = name.replace(/^#/, "").toLocaleLowerCase();
  // FNV-1a, for a spread that does not clump short similar names onto one hue.
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TAG_HUES[hash % TAG_HUES.length] ?? "structure";
}

/** The hue as a CSS value, ready to hand to a custom property. */
export function tagHueColor(name: string): string {
  return `var(--visp-hue-${tagHue(name)})`;
}
