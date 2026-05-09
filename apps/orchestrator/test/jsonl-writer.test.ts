import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlWriter } from "../src/adapters/jsonl-writer.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "jsonl-test-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("JsonlWriter", () => {
  it("creates parent dirs and appends one line per call", async () => {
    const path = join(scratch, "deep", "nested", "log.jsonl");
    const w = new JsonlWriter(path);
    await w.append({ a: 1 });
    await w.append({ b: 2 });
    const raw = await readFile(path, "utf8");
    expect(raw.split("\n").filter(Boolean)).toEqual([
      JSON.stringify({ a: 1 }),
      JSON.stringify({ b: 2 }),
    ]);
  });

  it("serializes 100 concurrent appends without interleaving", async () => {
    const path = join(scratch, "race.jsonl");
    const w = new JsonlWriter(path);
    const promises = Array.from({ length: 100 }, (_, i) => w.append({ i }));
    await Promise.all(promises);
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(100);
    // Each line must be a valid JSON object — no torn writes
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // Order must match call order (mutex-serialized)
    const indices = lines.map((l) => (JSON.parse(l) as { i: number }).i);
    expect(indices).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});
