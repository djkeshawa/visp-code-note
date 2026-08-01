import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "media", "scripts");
const codiconDirectory = join(projectRoot, "media", "codicons");

await rm(outputDirectory, { force: true, recursive: true });
await rm(codiconDirectory, { force: true, recursive: true });

await build({
  absWorkingDir: projectRoot,
  entryPoints: [
    "src/webview/editor.ts",
    "src/webview/graph.ts",
    "src/webview/notes.ts",
    "src/webview/tasks.ts",
    "src/webview/workspace.ts",
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

// Codicons give the webviews the same icon set VS Code uses for its own UI. The
// stylesheet references the font with a relative URL, so both files must land in
// the same directory under media/ for asWebviewUri to resolve them.
const codiconSource = join(projectRoot, "node_modules", "@vscode", "codicons", "dist");
await mkdir(codiconDirectory, { recursive: true });
for (const asset of ["codicon.css", "codicon.ttf"]) {
  await copyFile(join(codiconSource, asset), join(codiconDirectory, asset));
}
console.log(`  media/codicons/codicon.css, media/codicons/codicon.ttf`);
