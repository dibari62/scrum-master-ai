/**
 * Public surface of the canonical model (ADR-0003).
 *
 * Every other layer imports from `@/domain`, never from a file inside it, so
 * the model can be reorganised without a repository-wide rename.
 *
 * This layer depends on nothing: no framework, no ORM, no I/O. `npm run
 * boundaries` enforces it.
 */

export * from "./ids";
export * from "./source";
export * from "./common";
export * from "./organization";
export * from "./user";
export * from "./membership";
export * from "./project";
export * from "./credentials";

export * from "./work-item";
export * from "./state-transition";
export * from "./estimate-change";
export * from "./estimation-scale";
export * from "./acceptance-threshold";
export * from "./working-calendar";
export * from "./sprint";
export * from "./sprint-statistics";
export * from "./retrospective";
export * from "./availability";
export * from "./collaboration";

export * from "./skill";
export * from "./project-context";
export * from "./scrum-agent";
export * from "./sprint-report";
export * from "./sprint-health";
export * from "./bottleneck";
export * from "./daily-digest";
export * from "./project-qa";

export * from "./metric-catalog";
