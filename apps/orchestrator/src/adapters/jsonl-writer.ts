import { existsSync } from "node:fs";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";

// Read every well-formed JSON object from a JSONL file. Lines that fail to
// parse are dropped silently — the file is append-only and a torn final write
// is the only realistic source of bad lines. Returns [] when the file does
// not yet exist, so callers can treat "no log" and "empty log" identically.
export async function readJsonl<T = Record<string, unknown>>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // skip torn / malformed line
    }
  }
  return out;
}

// Append-only JSON-lines writer. One JSON object per line, durable to disk
// before resolving (so a crash after a successful publish() can never leave
// the dashboard's view of "this question was asked" diverged from the
// branch-scoped JSONL log).
//
// Concurrency: a process-local mutex serializes appends. JSONL files are
// expected to be written by exactly one process at a time (one orchestrator,
// one brainstorm session per task) — we don't try to coordinate across
// processes.
export class JsonlWriter {
  private readonly path: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  filePath(): string {
    return this.path;
  }

  async append(event: Record<string, unknown>): Promise<void> {
    // Chain on the previous append so concurrent calls serialize. We capture
    // the current tail before assigning a new one to avoid awaiting our own
    // promise (which would deadlock).
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
      if (!existsSync(this.path)) {
        await mkdir(dirname(this.path), { recursive: true });
      }
      const line = `${JSON.stringify(event)}\n`;
      // appendFile with utf8 encoding; node's fs.appendFile uses O_APPEND on
      // POSIX which is atomic for a single write call (writes within
      // PIPE_BUF/PAGE bounds, and our events are tiny).
      await appendFile(this.path, line, "utf8");
    } finally {
      release();
    }
  }
}
