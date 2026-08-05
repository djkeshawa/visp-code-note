import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "media", "scripts");
const codiconDirectory = join(projectRoot, "media", "codicons");
const fontDirectory = join(projectRoot, "media", "fonts");

await rm(outputDirectory, { force: true, recursive: true });
await rm(codiconDirectory, { force: true, recursive: true });
await rm(fontDirectory, { force: true, recursive: true });

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
 * IBM Plex Sans is the face rendered prose is set in. It is bundled rather than named in a
 * font stack because a stack renders differently on every machine — whichever family happens
 * to be installed wins — and a note should look the same wherever it is opened.
 *
 * The `complete` cuts rather than the `split` Latin1 subsets: the subsets are a third of the
 * size but stop at basic Latin, so a Polish or Czech note would drop to a fallback face
 * partway through a word. These carry Latin, Greek and Cyrillic in about 66KB each.
 */
const fontSource = join(projectRoot, "node_modules", "@ibm", "plex-sans", "fonts", "complete", "woff2");
await mkdir(fontDirectory, { recursive: true });
const fontCuts = [
  "IBMPlexSans-Regular.woff2",
  "IBMPlexSans-Italic.woff2",
  "IBMPlexSans-SemiBold.woff2",
  "IBMPlexSans-SemiBoldItalic.woff2",
  "IBMPlexSans-Bold.woff2",
  "IBMPlexSans-BoldItalic.woff2",
];
for (const cut of fontCuts) {
  await copyFile(join(fontSource, cut), join(fontDirectory, cut));
}
console.log(`  media/fonts/ — ${fontCuts.length} IBM Plex Sans cuts`);
