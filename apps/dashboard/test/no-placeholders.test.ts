import { describe, it, expect } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const FORBIDDEN = [
  /\bTODO\b/,
  /(?<!\w)placeholder(?!=|:)/i,
  /\blorem ipsum\b/i,
  /\bdummy data\b/i,
  /\bfake data\b/i,
  /\bTBD\b(?!\s*-)/,  // allow `TBD —` in copy that surfaces real TBDs
];

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "test" || entry === "e2e") continue;
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

describe("no-placeholders rule", () => {
  it("no source file contains forbidden placeholder strings", async () => {
    const offenders: { file: string; pattern: string; line: number }[] = [];
    for await (const file of walk(ROOT)) {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of FORBIDDEN) {
          if (pattern.test(lines[i]!)) {
            offenders.push({ file: file.slice(ROOT.length + 1), pattern: pattern.source, line: i + 1 });
          }
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
