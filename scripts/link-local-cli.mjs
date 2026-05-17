import { chmod, mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const target = join(repoRoot, "packages", "cli", "dist", "index.js");
const link = join(homedir(), ".local", "bin", "pi-harness");

await chmod(target, 0o755);
await mkdir(dirname(link), { recursive: true });
await rm(link, { force: true });
await symlink(target, link);

console.log(`pi-harness -> ${target}`);
