/**
 * Minimal structured logger. Exists so that the "no console.log in application
 * code" rule (AGENTS.md §7) has somewhere to point to.
 *
 * Records are emitted as one JSON object per line: readable in a terminal and
 * greppable in the Vercel log drain without any extra dependency.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured context attached to a record. Values must be JSON-serialisable. */
export type LogFields = Readonly<Record<string, unknown>>;

export type LogRecord = {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: Date;
  readonly fields?: LogFields;
};

/** Where formatted records are written. Injectable to keep the logger testable. */
export type LogSink = (level: LogLevel, line: string) => void;

export type LoggerOptions = {
  readonly minimumLevel?: LogLevel;
  readonly sink?: LogSink;
  /** Injectable clock: tests must not depend on the wall clock. */
  readonly now?: () => Date;
};

export type Logger = {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
};

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in SEVERITY;
}

export function shouldLog(level: LogLevel, minimumLevel: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[minimumLevel];
}

/** Serialises a record as a single JSON line. Timestamps are always UTC (§7). */
export function formatLogRecord(record: LogRecord): string {
  return JSON.stringify({
    level: record.level,
    message: record.message,
    timestamp: record.timestamp.toISOString(),
    ...(record.fields ?? {}),
  });
}

const consoleSink: LogSink = (level, line) => {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimumLevel = options.minimumLevel ?? "info";
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (!shouldLog(level, minimumLevel)) return;
    sink(level, formatLogRecord({ level, message, timestamp: now(), fields }));
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

function defaultMinimumLevel(): LogLevel {
  const configured = process.env["LOG_LEVEL"];
  if (isLogLevel(configured)) return configured;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export const logger: Logger = createLogger({ minimumLevel: defaultMinimumLevel() });
