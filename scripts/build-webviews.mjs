import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "media", "scripts");

await rm(outputDirectory, { force: true, recursive: true });

await build({
  absWorkingDir: projectRoot,
  entryPoints: [
    "src/webview/editor.ts",
    "src/webview/graph.ts",
    "src/webview/tasks.ts",
    "src/webview/backlinks.ts",
  ],
  bundle: true,
  entryNames: "[name]",
  format: "esm",
  logLevel: "info",
  minify: true,
  outbase: "src/webview",
  outdir: "media/scripts",
  platform: "browser",
  sourcemap: false,
  splitting: false,
  target: "es2022",
});
