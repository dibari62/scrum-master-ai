import { beforeEach, describe, expect, it } from "vitest";

import {
  agingWorkItem,
  blockedTime,
  cycleTime,
  flowEfficiency,
  leadTime,
  mean,
  median,
  percentile,
  reviewWaitTime,
  summariseFlow,
  unavailable,
} from "@/metrics";

import { DAY, HOUR, item, move, resetIds } from "./builders";

const ASOF = new Date("2026-04-20T09:00:00.000Z");

beforeEach(() => resetIds());

/** A tidy history: created, started, reviewed, finished. */
function happyPath() {
  return [
    move(null, "todo", "2026-04-06T09:00:00.000Z"),
    move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
    move("in_progress", "in_review", "2026-04-09T09:00:00.000Z"),
    move("in_review", "done", "2026-04-10T09:00:00.000Z"),
  ];
}

describe("cycleTime", () => {
  it("misura dal primo in_progress al primo done", () => {
    const result = cycleTime(happyPath());

    expect(result.available).toBe(true);
    if (result.available) expect(result.value).toBe(3 * DAY);
  });

  it("non è disponibile per un elemento non concluso", () => {
    const result = cycleTime([
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
    ]);

    expect(result).toEqual(unavailable("no-qualifying-data", 0));
  });

  it("non è disponibile su una storia vuota", () => {
    expect(cycleTime([]).available).toBe(false);
  });

  it("usa il PRIMO done anche se l'elemento è stato riaperto e richiuso", () => {
    // Misurare fino all'ultimo done farebbe sembrare la riapertura una
    // consegna più lenta, mentre è rilavorazione: la racconta reopenRate.
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-08T09:00:00.000Z"),
      move("done", "in_progress", "2026-04-15T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-18T09:00:00.000Z"),
    ];

    const result = cycleTime(history);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1 * DAY);
  });

  it("non è disponibile se l'elemento è arrivato a done senza passare da in_progress", () => {
    const result = cycleTime([
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "done", "2026-04-07T09:00:00.000Z"),
    ]);

    expect(result.available).toBe(false);
  });
});

describe("leadTime", () => {
  it("misura dalla creazione al primo done, quindi include l'attesa in backlog", () => {
    const created = item({ sourceCreatedAt: "2026-04-01T09:00:00.000Z" });
    const result = leadTime(created, happyPath());

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(9 * DAY);
  });

  it("è più lungo del cycle time quando l'elemento ha atteso in backlog", () => {
    const created = item({ sourceCreatedAt: "2026-04-01T09:00:00.000Z" });
    const lead = leadTime(created, happyPath());
    const cycle = cycleTime(happyPath());

    if (!lead.available || !cycle.available) throw new Error("attese disponibili");
    expect(lead.value).toBeGreaterThan(cycle.value);
  });

  it("non è disponibile per un elemento non concluso", () => {
    expect(leadTime(item(), [move(null, "todo", "2026-04-06T09:00:00.000Z")]).available).toBe(
      false,
    );
  });
});

describe("blockedTime", () => {
  it("è zero per un elemento mai bloccato", () => {
    expect(blockedTime(happyPath(), ASOF)).toBe(0);
  });

  it("somma tutte le permanenze in blocked", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "blocked", "2026-04-07T09:00:00.000Z"),
      move("blocked", "in_progress", "2026-04-09T09:00:00.000Z"),
      move("in_progress", "blocked", "2026-04-10T09:00:00.000Z"),
      move("blocked", "done", "2026-04-11T09:00:00.000Z"),
    ];

    expect(blockedTime(history, ASOF)).toBe(3 * DAY);
  });

  it("conta il blocco ancora in corso fino all'istante di riferimento", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "blocked", "2026-04-18T09:00:00.000Z"),
    ];

    expect(blockedTime(history, ASOF)).toBe(2 * DAY);
  });
});

describe("flowEfficiency", () => {
  it("è 1 quando non c'è stata attesa", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-08T09:00:00.000Z"),
    ];

    const result = flowEfficiency(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("scende quando l'elemento resta in attesa di revisione", () => {
    // Un giorno di lavoro, tre in coda di revisione, poi concluso: un quarto
    // del tempo è stato lavoro vero. Prima della decisione su Q1 questo caso
    // dava 1, perché `in_review` veniva contato come lavoro.
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "in_review", "2026-04-08T09:00:00.000Z"),
      move("in_review", "done", "2026-04-11T09:00:00.000Z"),
    ];

    const result = flowEfficiency(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBeCloseTo(0.25, 10);
  });

  it("scende quando l'elemento resta bloccato", () => {
    // Un giorno di lavoro, tre di blocco, poi concluso: un quarto del tempo
    // è stato lavoro vero.
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "blocked", "2026-04-08T09:00:00.000Z"),
      move("blocked", "done", "2026-04-11T09:00:00.000Z"),
    ];

    const result = flowEfficiency(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBeCloseTo(0.25, 10);
  });

  it("non conta l'attesa in backlog come inefficienza", () => {
    // Il tempo prima di in_progress è una scelta di priorità, non un
    // problema di flusso.
    const withLongBacklog = [
      move(null, "todo", "2026-04-01T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-08T09:00:00.000Z"),
    ];

    const result = flowEfficiency(withLongBacklog, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("non è disponibile se il lavoro non è mai iniziato", () => {
    expect(flowEfficiency([move(null, "todo", "2026-04-06T09:00:00.000Z")], ASOF).available).toBe(
      false,
    );
  });
});

describe("agingWorkItem", () => {
  it("misura da quanto l'elemento è fermo nello stato attuale", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "blocked", "2026-04-14T09:00:00.000Z"),
    ];

    const result = agingWorkItem(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(6 * DAY);
  });

  it("non si applica a un elemento concluso", () => {
    // L'invecchiamento serve a far emergere ciò che è fermo adesso: includere
    // il concluso seppellirebbe il segnale sotto la storia.
    expect(agingWorkItem(happyPath(), ASOF).available).toBe(false);
  });

  it("non si applica a un elemento annullato", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "cancelled", "2026-04-07T09:00:00.000Z"),
    ];

    expect(agingWorkItem(history, ASOF).available).toBe(false);
  });

  it("non è disponibile senza storia", () => {
    expect(agingWorkItem([], ASOF)).toEqual(unavailable("no-data", 0));
  });
});

describe("reviewWaitTime", () => {
  it("misura l'ultima permanenza in revisione", () => {
    const result = reviewWaitTime(happyPath(), ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1 * DAY);
  });

  it("misura l'attesa ancora in corso", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "in_review", "2026-04-16T09:00:00.000Z"),
    ];

    const result = reviewWaitTime(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(4 * DAY);
  });

  it("usa l'ULTIMA revisione, non la somma di tutte", () => {
    // Quando la revisione è il collo di bottiglia la domanda è quanto dura
    // l'attesa attuale; sommare i giri precedenti risponderebbe ad altro.
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_review", "2026-04-07T09:00:00.000Z"),
      move("in_review", "in_progress", "2026-04-12T09:00:00.000Z"),
      move("in_progress", "in_review", "2026-04-18T09:00:00.000Z"),
    ];

    const result = reviewWaitTime(history, ASOF);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(2 * DAY);
  });

  it("non è disponibile se non è mai stato in revisione", () => {
    expect(reviewWaitTime([move(null, "todo", "2026-04-06T09:00:00.000Z")], ASOF).available).toBe(
      false,
    );
  });
});

describe("statistiche di sintesi", () => {
  it("non restituiscono NaN su un campione vuoto", () => {
    // Regola esplicita del modulo: mai NaN, mai zero muto.
    for (const result of [mean([]), median([]), percentile([], 85)]) {
      expect(result.available).toBe(false);
      if (!result.available) expect(result.reason).toBe("empty-denominator");
    }
  });

  it("la mediana resiste a un valore estremo, la media no", () => {
    const values = [1, 1, 1, 1, 100];

    const m = mean(values);
    const md = median(values);
    if (!m.available || !md.available) throw new Error("attese disponibili");

    expect(md.value).toBe(1);
    expect(m.value).toBeGreaterThan(20);
  });

  it("dichiarano sempre la numerosità del campione", () => {
    const result = mean([1, 2, 3]);
    expect(result.sampleSize).toBe(3);
  });

  it("l'85° percentile interpola fra i vicini", () => {
    const result = percentile([0, 10], 85);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(8.5);
  });

  it("su un solo valore ogni statistica coincide con quel valore", () => {
    const result = percentile([7], 85);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(7);
  });
});

describe("summariseFlow", () => {
  const ITEM_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const ITEM_B = "bbbbbbbb-0000-4000-8000-000000000002";

  it("su un insieme vuoto dichiara l'indisponibilità invece di restituire zero", () => {
    const summary = summariseFlow([], [], ASOF);

    expect(summary.consideredCount).toBe(0);
    expect(summary.completedCount).toBe(0);
    expect(summary.cycleTime.mean.available).toBe(false);
    expect(summary.reopenRate.available).toBe(false);
  });

  it("ignora nel calcolo gli elementi non conclusi, ma li conta come considerati", () => {
    const items = [item({ id: ITEM_A }), item({ id: ITEM_B })];
    const transitions = [
      ...happyPath().map((t) => ({ ...t, workItemId: ITEM_A as never })),
      move(null, "todo", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_B }),
      move("todo", "in_progress", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const summary = summariseFlow(items, transitions, ASOF);

    expect(summary.consideredCount).toBe(2);
    expect(summary.completedCount).toBe(1);
    expect(summary.cycleTime.mean.sampleSize).toBe(1);
  });

  it("calcola il tasso di riapertura sui soli elementi conclusi", () => {
    // Un elemento mai concluso non può essere riaperto: contarlo al
    // denominatore diluirebbe il tasso fino a renderlo privo di significato.
    const items = [item({ id: ITEM_A }), item({ id: ITEM_B })];
    const transitions = [
      move(null, "todo", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move("done", "in_progress", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-10T09:00:00.000Z", { workItemId: ITEM_A }),

      move(null, "todo", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const summary = summariseFlow(items, transitions, ASOF);

    if (!summary.reopenRate.available) throw new Error("atteso disponibile");
    expect(summary.reopenRate.value).toBe(1);
    expect(summary.reopenRate.sampleSize).toBe(1);
  });

  it("funziona anche con le transizioni ricevute alla rinfusa", () => {
    const items = [item({ id: ITEM_A })];
    const ordered = happyPath().map((t) => ({ ...t, workItemId: ITEM_A as never }));
    const shuffled = [ordered[3]!, ordered[1]!, ordered[0]!, ordered[2]!];

    const summary = summariseFlow(items, shuffled, ASOF);
    expect(summary.completedCount).toBe(1);
    if (!summary.cycleTime.mean.available) throw new Error("atteso disponibile");
    expect(summary.cycleTime.mean.value).toBe(3 * DAY);
  });
});

describe("elementi senza stima", () => {
  it("non impediscono il calcolo delle metriche di tempo", () => {
    // Le metriche di flusso misurano tempo, non punti: un elemento non stimato
    // deve contribuire comunque.
    const unestimated = item({ estimate: null });
    const result = leadTime(unestimated, happyPath());

    expect(result.available).toBe(true);
  });
});

describe("sprint di un solo giorno", () => {
  it("produce durate positive e coerenti", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-06T10:00:00.000Z"),
      move("in_progress", "done", "2026-04-06T17:00:00.000Z"),
    ];

    const result = cycleTime(history);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(7 * HOUR);
  });
});
