import { posix } from "node:path";
import { titleToFileName } from "../domain/normalization";

export interface MissingNotePath {
  readonly relativePath: string;
  readonly title: string;
}

export function planMissingNotePath(
  sourceRelativePath: string,
  decodedTarget: string,
): MissingNotePath | undefined {
  const target = decodedTarget.trim().replace(/\\/g, "/");
  if (!target.includes("/") && !target.startsWith(".")) return undefined;

  const withoutExtension = target.replace(/\.md$/i, "");
  const relative = posix.normalize(
    target.startsWith("/")
      ? withoutExtension.replace(/^\/+/, "")
      : posix.join(posix.dirname(sourceRelativePath.replace(/\\/g, "/")), withoutExtension),
  );
  if (
    relative === "" ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith("../") ||
    posix.isAbsolute(relative)
  ) {
    throw new Error("The missing-note path would escape the current workspace folder.");
  }

  const title = posix.basename(relative);
  const fileName = `${title}.md`;
  if (titleToFileName(title) !== fileName) {
    throw new Error("The missing-note path contains characters that are not safe in a file name.");
  }
  return { relativePath: `${relative}.md`, title };
}
