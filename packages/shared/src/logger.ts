import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Secrets and session material are redacted at the serializer level so a
 * careless `log.info({ req })` cannot leak them.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.SERVICE_NAME ?? "web" },
  redact: {
    paths: [
      "*.cookie",
      "*.authorization",
      "*.sessionToken",
      "*.SESSION_SECRET",
      "*.S3_SECRET_KEY",
      "*.METADATA_API_KEY",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;
let reporter: ErrorReporter | undefined;

/** Error-monitoring hook: plug Sentry/Datadog/etc. here without touching call sites. */
export function setErrorReporter(fn: ErrorReporter): void {
  reporter = fn;
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  logger.error({ err: error, ...context }, "unhandled error");
  try {
    reporter?.(error, context);
  } catch {
    // reporters must never break request handling
  }
}

/** Minimal in-process counters, exported for the admin health view and /api/health. */
const counters = new Map<string, number>();
export const metrics = {
  inc(name: string, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },
  snapshot(): Record<string, number> {
    return Object.fromEntries(counters);
  },
};
