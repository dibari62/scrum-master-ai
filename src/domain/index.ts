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
export * from "./common";
export * from "./organization";
export * from "./user";
export * from "./membership";
export * from "./project";
export * from "./credentials";
