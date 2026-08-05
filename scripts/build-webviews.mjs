import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "media", "scripts");
const codiconDirectory = join(projectRoot, "media", "codicons");
const fontDirectory = join(projectRoot, "media", "fonts");

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

/*
 * The prose typeface is checked in under `media/fonts/` rather than copied out of a package
 * at build time, so nothing here needs to touch it.
 *
 * It used to come from `@ibm/plex-sans`, which drags in `@ibm/telemetry-js` and its
 * `postinstall` — a script that runs and reports on every `npm install`. That is a poor
 * trade for six static binaries that never change: a build-time dependency and an install
 * hook, which is precisely the surface npm supply-chain worms are delivered through. Six
 * files in the repository have no install step, no network, and no maintainer to be
 * compromised. Still SIL OFL 1.1 — see THIRD_PARTY_NOTICES.md.
 */
const fontCount = (await readdir(fontDirectory)).filter((name) => name.endsWith(".woff2")).length;
if (fontCount === 0) throw new Error("media/fonts/ holds no woff2 files — the prose face is missing.");
console.log(`  media/fonts/ — ${fontCount} checked-in IBM Plex Sans cuts`);
