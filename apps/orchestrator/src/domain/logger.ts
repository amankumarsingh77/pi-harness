import { pino, type Logger as PinoLogger, type LoggerOptions } from "pino";

// Project-wide logger interface. Mirrors pino's level methods so a pino
// instance satisfies it directly, while keeping the contract small enough
// that tests can pass a plain stub.
//
// Each method accepts either (msg) for a flat string line or (bindings, msg)
// to attach structured fields. Bindings flow through to the JSON output in
// production and are pretty-printed in dev.
export type LogBindings = Record<string, unknown>;

export type Logger = {
  debug: (msgOrBindings: string | LogBindings, msg?: string) => void;
  info: (msgOrBindings: string | LogBindings, msg?: string) => void;
  warn: (msgOrBindings: string | LogBindings, msg?: string) => void;
  error: (msgOrBindings: string | LogBindings, msg?: string) => void;
  child: (bindings: LogBindings) => Logger;
};

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
export type LogFormat = "json" | "pretty";

export type CreateLoggerOptions = {
  level: LogLevel;
  format: LogFormat;
  // Stable bindings attached to every line — service name, hostname, etc.
  base?: LogBindings;
};

// Build the underlying pino instance. Exposed because Fastify accepts a
// pino instance via its `loggerInstance` option — sharing the instance
// ensures HTTP request lines and runtime lines share level, formatting,
// and (in async hooks) request context.
export function createPinoLogger(opts: CreateLoggerOptions): PinoLogger {
  const pinoOpts: LoggerOptions = {
    level: opts.level,
    base: opts.base ?? null,
    // Strip pid/hostname; keep the line lean. Bindings via `base` add what
    // the operator actually wants to see.
  };
  if (opts.format === "pretty") {
    pinoOpts.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false,
      },
    };
  }
  return pino(pinoOpts);
}

// Wrap an existing pino instance — useful when Fastify or another framework
// already constructed one and we want to expose the same level/transport
// through the project's Logger surface.
export function fromPino(p: PinoLogger): Logger {
  return wrap(p);
}

// Adapt PinoLogger to our minimal Logger surface. Mostly identity — pino's
// own methods already match the (msg | bindings, msg?) overloads — but
// going through wrap() means every Logger is the same shape regardless of
// whether it came from pino, a child, or a test stub.
function wrap(p: PinoLogger): Logger {
  return {
    debug: (a, b) => (typeof a === "string" ? p.debug(a) : p.debug(a, b)),
    info: (a, b) => (typeof a === "string" ? p.info(a) : p.info(a, b)),
    warn: (a, b) => (typeof a === "string" ? p.warn(a) : p.warn(a, b)),
    error: (a, b) => (typeof a === "string" ? p.error(a) : p.error(a, b)),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

// Silent logger for tests that don't want log output cluttering vitest
// reporters. Use the `silent` level; pino still constructs but emits
// nothing. No transport, no async pipe — safe to construct in any test.
export function silentLogger(): Logger {
  return wrap(pino({ level: "silent" }));
}
