import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "out");
const compiler = join(projectRoot, "node_modules", "typescript", "bin", "tsc");

await rm(outputDirectory, { force: true, recursive: true });

const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;

/*
 * The MCP server, as one self-contained file. Agents outside VS Code start it with plain Node,
 * and the extension copies it to a stable path on activation (see `vscode/mcpSetup.ts`), so it
 * cannot lean on the rest of `out/` sitting beside it.
 */
if (process.exitCode === 0) {
  const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  await build({
    entryPoints: [join(projectRoot, "src", "mcp", "server.ts")],
    outfile: join(outputDirectory, "mcp", "visp-notes-mcp.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
    define: { VISP_NOTES_VERSION: JSON.stringify(version) },
    logLevel: "warning",
  });
}
