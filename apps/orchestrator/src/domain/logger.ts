// Minimal logger interface the orchestrator's runtime modules use. Decouples
// scheduler / startup logging from a specific backend so tests can pass a
// silent logger and production wires Fastify's pino instance.
//
// Methods mirror the levels used in this codebase. Add more (debug, trace) if
// needed; do not add transport configuration here — that's the implementer's
// job.
export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string, err?: unknown) => void;
  error: (msg: string, err?: unknown) => void;
};

// Default console-backed logger. Useful for the startup path before a Fastify
// app exists, and as a fallback. Production code paths inside an HTTP request
// should prefer the request-scoped pino logger Fastify provides.
export const consoleLogger: Logger = {
  info: (msg) => {
    // eslint-disable-next-line no-console
    console.log(msg);
  },
  warn: (msg, err) => {
    // eslint-disable-next-line no-console
    console.warn(msg, ...(err === undefined ? [] : [err]));
  },
  error: (msg, err) => {
    // eslint-disable-next-line no-console
    console.error(msg, ...(err === undefined ? [] : [err]));
  },
};
