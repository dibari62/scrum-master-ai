/**
 * The metrics engine.
 *
 * Pure by construction: input data, output numbers. No I/O, no database, no
 * network, no model calls, and no reading of the current clock — the reference
 * instant always arrives as a parameter, or the same input would produce a
 * different answer tomorrow (ADR-0002).
 *
 * Every number the interface shows originates here. An LLM may narrate these
 * figures; it may never produce them (R1).
 */

export * from "./result";
export * from "./history";
export * from "./estimates";
export * from "./estimation";
export * from "./acceptance";
export * from "./release-plan";
export * from "./guidelines";
export * from "./flow";
export * from "./sprint";
export * from "./planning";
export * from "./retrospective";
export * from "./health";
export * from "./bottleneck";
export * from "./daily";
export * from "./catalog";
