import { Text } from "@codemirror/state";
import type { LineSeparator } from "./offsetMapping.js";

export function createEditorDocument(source: string): Text {
  return Text.of(normalizeEditorInput(source).split("\n"));
}

export function normalizeEditorInput(source: string): string {
  return source.replace(/\r\n?|\n/g, "\n");
}

export function serializeEditorDocument(
  document: Text,
  lineSeparator: LineSeparator,
): string {
  return document.sliceString(0, document.length, lineSeparator);
}
