export function wikiCompletionText(target: string, textAfterCursor: string): string {
  const existingClosers = textAfterCursor.startsWith("]]")
    ? 2
    : textAfterCursor.startsWith("]") ? 1 : 0;
  return `${target}${"]".repeat(2 - existingClosers)}`;
}
