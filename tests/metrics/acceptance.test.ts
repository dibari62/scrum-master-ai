import { beforeEach, describe, expect, it } from "vitest";

import { productBacklog, thresholdAtPosition } from "@/domain";
import { acceptanceCoverage } from "@/metrics";

import { item, resetIds, uuidFor } from "./builders";

const CUTOFFS = { must: 2, should: 2, later: 1 } as const;

function backlogItem(
  name: string,
  position: number | null,
  estimate: { value: number; unit: "points" | "hours" } | null = { value: 3, unit: "points" },
) {
  return item({ id: uuidFor(name), title: name, backlogOrder: position, estimate });
}

/** Names of the items in a band, for readable assertions. */
function counts(result: ReturnType<typeof acceptanceCoverage>) {
  return Object.fromEntries(result.bands.map((band) => [band.threshold, band.itemCount]));
}

describe("thresholdAtPosition", () => {
  it("assegna le fasce nell'ordine in cui il libro le elenca", () => {
    expect(thresholdAtPosition(0, CUTOFFS)).toBe("must");
    expect(thresholdAtPosition(1, CUTOFFS)).toBe("must");
    expect(thresholdAtPosition(2, CUTOFFS)).toBe("should");
    expect(thresholdAtPosition(3, CUTOFFS)).toBe("should");
    expect(thresholdAtPosition(4, CUTOFFS)).toBe("later");
    expect(thresholdAtPosition(5, CUTOFFS)).toBe("speculative");
  });

  it("tutto ciò che sta sotto l'ultimo taglio è ipotetico, per quanto lontano", () => {
    expect(thresholdAtPosition(9_999, CUTOFFS)).toBe("speculative");
  });

  it("senza soglie dichiarate non assegna alcuna fascia", () => {
    /*
     * `null` non è «tutto ipotetico».
     *
     * Le soglie sono un impegno contrattuale: colorare di verde un backlog su
     * cui nessuno si è pronunciato equivarrebbe a dichiarare che non si deve
     * nulla, che è un'affermazione, non un'assenza di affermazioni.
     */
    expect(thresholdAtPosition(0, null)).toBeNull();
  });

  it("una fascia larga zero non assorbe nulla", () => {
    // «Nessun obbligo nella 1.0» è una posizione legittima e va rappresentabile.
    expect(thresholdAtPosition(0, { must: 0, should: 2, later: 0 })).toBe("should");
    expect(thresholdAtPosition(2, { must: 0, should: 2, later: 0 })).toBe("speculative");
  });

  it("una posizione negativa o non intera non ha fascia", () => {
    expect(thresholdAtPosition(-1, CUTOFFS)).toBeNull();
    expect(thresholdAtPosition(1.5, CUTOFFS)).toBeNull();
  });
});

describe("acceptanceCoverage", () => {
  beforeEach(resetIds);

  it("senza soglie dichiarate non classifica nulla", () => {
    const backlog = productBacklog([backlogItem("prima", 0), backlogItem("seconda", 1)]);
    const result = acceptanceCoverage(backlog, null);

    expect(result.unclassified).toBe(2);
    expect(counts(result)).toEqual({ must: 0, should: 0, later: 0, speculative: 0 });
  });

  it("divide il backlog nelle quattro fasce secondo i tagli", () => {
    const backlog = productBacklog([
      backlogItem("a", 0),
      backlogItem("b", 1),
      backlogItem("c", 2),
      backlogItem("d", 3),
      backlogItem("e", 4),
      backlogItem("f", 5),
      backlogItem("g", 6),
    ]);

    expect(counts(acceptanceCoverage(backlog, CUTOFFS))).toEqual({
      must: 2,
      should: 2,
      later: 1,
      speculative: 2,
    });
  });

  it("una fascia vuota compare lo stesso, con zero", () => {
    const backlog = productBacklog([backlogItem("unica", 0)]);
    const result = acceptanceCoverage(backlog, CUTOFFS);

    expect(result.bands).toHaveLength(4);
    expect(counts(result)).toEqual({ must: 1, should: 0, later: 0, speculative: 0 });
  });

  it("ciò che sta sotto l'ultimo taglio è ipotetico", () => {
    const backlog = productBacklog([
      backlogItem("a", 0),
      backlogItem("b", 1),
      backlogItem("c", 2),
    ]);

    expect(counts(acceptanceCoverage(backlog, { must: 1, should: 0, later: 0 }))).toEqual({
      must: 1,
      should: 0,
      later: 0,
      speculative: 2,
    });
  });

  it("un elemento senza posizione non finisce in una fascia", () => {
    const backlog = productBacklog([backlogItem("collocata", 0), backlogItem("mai collocata", null)]);
    const result = acceptanceCoverage(backlog, CUTOFFS);

    expect(result.unclassified).toBe(1);
    expect(counts(result).must).toBe(1);
  });

  it("somma le stime di ciascuna fascia, non solo gli elementi", () => {
    const backlog = productBacklog([
      backlogItem("a", 0, { value: 5, unit: "points" }),
      backlogItem("b", 1, { value: 8, unit: "points" }),
      backlogItem("c", 2, { value: 3, unit: "points" }),
    ]);

    const result = acceptanceCoverage(backlog, CUTOFFS);

    expect(result.bands[0]?.total.points).toBe(13);
    expect(result.bands[1]?.total.points).toBe(3);
  });

  it("tiene separate le unità di stima dentro una fascia", () => {
    /*
     * Un contratto è esattamente il posto sbagliato in cui confondere punti e
     * ore: «dobbiamo consegnare 13» non dice nulla se 5 sono punti e 8 ore.
     */
    const backlog = productBacklog([
      backlogItem("a", 0, { value: 5, unit: "points" }),
      backlogItem("b", 1, { value: 8, unit: "hours" }),
    ]);

    const band = acceptanceCoverage(backlog, CUTOFFS).bands[0];

    expect(band?.total.points).toBe(5);
    expect(band?.total.hours).toBe(8);
  });

  it("un backlog vuoto dà quattro fasce vuote, non un errore", () => {
    const result = acceptanceCoverage([], CUTOFFS);

    expect(result.bands).toHaveLength(4);
    expect(result.unclassified).toBe(0);
  });
});
