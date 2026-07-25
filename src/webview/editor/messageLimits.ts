export const MAX_EDITOR_MESSAGE_SOURCE_LENGTH = 10_000_000;

export function fitsEditorSourceMessage(source: string, expectedSource: string): boolean {
  return source.length <= MAX_EDITOR_MESSAGE_SOURCE_LENGTH
    && expectedSource.length <= MAX_EDITOR_MESSAGE_SOURCE_LENGTH;
}

export const SOURCE_LIMIT_MESSAGE =
  "This edit exceeds the 10-million-character safety limit. Edit this note in VS Code’s text editor.";
