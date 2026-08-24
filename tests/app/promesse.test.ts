import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Whether the interface promises things that have since arrived.
 *
 * **The failure this exists to stop, told properly.** `/organizzazione` once
 * announced «i progetti arrivano con i prossimi traguardi» and offered no link
 * to the projects that already existed: whoever signed in read that there was
 * nothing to see, and stopped. It was fixed, and a comment was written above the
 * fix explaining the trap.
 *
 * Three lines *below* that comment sat «Lo Scrum Master AI arriva con i prossimi
 * traguardi», which stayed there for three milestones — past the agent being
 * created, configured, and made to write sprint reports.
 *
 * The lesson is not that somebody was careless. It is that a promise about the
 * future is a claim with an expiry date and nobody to enforce it: the interface
 * has no way of knowing when the roadmap has moved past it. The roadmap lives in
 * `docs/roadmap.md`, which is read by people who are looking for a roadmap.
 *
 * So the interface does not carry roadmap language at all. A link is a better
 * promise than a sentence: it either works, or it is obviously broken.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/**
 * Phrases that date the interface.
 *
 * Deliberately narrow: this is not a style rule about the word "presto", it is a
 * ban on the interface describing the project's schedule.
 */
const ROADMAP_PHRASES = [
  "prossimi traguardi",
  "prossimo traguardo",
  "in arrivo con",
  "sarà disponibile con",
  "arriverà con",
];

function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    if (/\.tsx?$/.test(entry)) found.push(path);
  }

  return found;
}

describe("promesse sul futuro nell'interfaccia", () => {
  it("nessuna pagina annuncia ciò che arriverà con i prossimi traguardi", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(APP_DIR)) {
      const source = readFileSync(path, "utf8");

      for (const phrase of ROADMAP_PHRASES) {
        // Il commento che spiega il divieto contiene la frase per forza: si
        // cerca nel testo reso, non in ciò che è scritto per chi legge il codice.
        const withoutComments = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/.*$/gm, "");

        if (withoutComments.toLowerCase().includes(phrase)) {
          offenders.push(`${path.replace(process.cwd(), "").replace(/\\/g, "/")}: «${phrase}»`);
        }
      }
    }

    expect(
      offenders,
      "il calendario del progetto sta in docs/roadmap.md, non nell'interfaccia: " +
        `una promessa non sa quando è stata mantenuta.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
