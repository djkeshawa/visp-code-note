/**
 * Every `[[…]]` on a line, found by scanning rather than by `/\[\[([^\]\r\n]+)\]\]/g`.
 *
 * That pattern is the one `parseWikiLinks` documents having removed for being quadratic, and
 * it survived here: with unclosed openers the engine retries the run from every offset. This
 * runs in the webview on every decoration rebuild — every keystroke, scroll and caret move —
 * so a single long line of `[[` cost seconds per frame.
 *
 * Linear because the cursor only ever moves forward: when a candidate fails, it fails at a
 * `]` or a line break, and every later opener before that character would fail at it too, so
 * the scan resumes past it rather than at the next opener.
 */
export function wikiLinkSpans(text: string): readonly { readonly start: number; readonly end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("[[", index);
    if (open < 0) break;
    let scan = open + 2;
    while (scan < text.length) {
      const character = text[scan];
      if (character === "]" || character === "\r" || character === "\n") break;
      scan += 1;
    }
    if (text[scan] === "]" && text[scan + 1] === "]" && scan > open + 2) {
      spans.push({ start: open, end: scan + 2 });
      index = scan + 2;
    } else {
      index = scan + 1;
    }
  }
  return spans;
}
