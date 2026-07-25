import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "out-tests");
const compiler = join(projectRoot, "node_modules", "typescript", "bin", "tsc");

await rm(outputDirectory, { force: true, recursive: true });

const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.test.json"], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
