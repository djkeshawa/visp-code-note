import { posix } from "node:path";

export function normalizeWorkspaceRelativeFolder(value: string): string {
  const candidate = value.trim().replace(/\\/g, "/");
  if (candidate === "") {
    return "";
  }
  if (candidate.includes("\0") || posix.isAbsolute(candidate) || /^[a-zA-Z]:\//.test(candidate)) {
    throw new Error("vispNotes.notesFolder must be a workspace-relative folder.");
  }

  const normalized = posix.normalize(candidate).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("vispNotes.notesFolder cannot point outside the workspace.");
  }
  return normalized === "." ? "" : normalized;
}
