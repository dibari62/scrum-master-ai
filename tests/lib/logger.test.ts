import { describe, expect, it } from "vitest";

import {
  createLogger,
  formatLogRecord,
  isLogLevel,
  shouldLog,
  type LogLevel,
} from "@/lib/logger";

const FIXED_NOW = new Date(Date.UTC(2026, 7, 19, 12, 0, 0));

/** Captures emitted lines so the assertions look at real output, not mocks. */
function collectingLogger(minimumLevel: LogLevel) {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createLogger({
    minimumLevel,
    now: () => FIXED_NOW,
    sink: (level, line) => lines.push({ level, line }),
  });
  return { logger, lines };
}

describe("formatLogRecord", () => {
  it("emette una riga JSON con timestamp UTC", () => {
    const line = formatLogRecord({
      level: "info",
      message: "sprint ingerito",
      timestamp: FIXED_NOW,
    });

    expect(JSON.parse(line)).toEqual({
      level: "info",
      message: "sprint ingerito",
      timestamp: "2026-08-19T12:00:00.000Z",
    });
  });

  it("appiattisce i campi strutturati nel record", () => {
    const line = formatLogRecord({
      level: "warn",
      message: "cold start",
      timestamp: FIXED_NOW,
      fields: { organizationId: "org_1", durationMs: 1200 },
    });

    expect(JSON.parse(line)).toMatchObject({
      organizationId: "org_1",
      durationMs: 1200,
    });
  });
});

describe("shouldLog", () => {
  it("scarta i livelli sotto la soglia e tiene quelli pari o superiori", () => {
    expect(shouldLog("debug", "info")).toBe(false);
    expect(shouldLog("info", "info")).toBe(true);
    expect(shouldLog("error", "warn")).toBe(true);
  });
});

describe("isLogLevel", () => {
  it("riconosce solo i livelli dichiarati", () => {
    expect(isLogLevel("warn")).toBe(true);
    expect(isLogLevel("verbose")).toBe(false);
    expect(isLogLevel(42)).toBe(false);
  });
});

describe("createLogger", () => {
  it("scrive sul sink i record che superano la soglia", () => {
    const { logger, lines } = collectingLogger("info");

    logger.debug("non deve comparire");
    logger.info("progetto creato", { projectId: "prj_1" });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(JSON.parse(lines[0]?.line ?? "{}")).toEqual({
      level: "info",
      message: "progetto creato",
      timestamp: "2026-08-19T12:00:00.000Z",
      projectId: "prj_1",
    });
  });

  it("propaga il livello a ogni riga emessa", () => {
    const { logger, lines } = collectingLogger("debug");

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(lines.map((entry) => entry.level)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });
});
