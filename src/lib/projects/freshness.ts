import type { ConnectorChoice } from "@/domain";

/**
 * Da quanto tempo i dati non vengono riletti.
 *
 * **Il problema che risolve.** La lettura da Jira parte solo quando qualcuno
 * preme un pulsante. Finché non esiste un job schedulato, una dashboard mostra
 * la fotografia dell'ultima volta che qualcuno se n'è ricordato — e non c'è
 * nulla che lo dica. Le metriche restano *corrette*: descrivono fedelmente i
 * dati che ci sono. Sono i dati a essere di ieri, ed è una differenza che chi
 * guarda non può indovinare.
 *
 * Un numero vecchio presentato come attuale è peggio di nessun numero: si
 * prendono decisioni sulla base di uno sprint che nel frattempo è andato avanti.
 *
 * Funzione pura, e l'istante arriva come argomento: una funzione che legge
 * l'orologio non si può provare (ADR-0002).
 */

/**
 * Dopo quante ore una lettura si considera vecchia.
 *
 * Ventiquattro, perché il ritmo dello Scrum è quotidiano: la riunione di ogni
 * giorno guarda com'è andata quella prima. Dati fermi da più di un giorno
 * arrivano al momento in cui servirebbero di più, e proprio lì ingannano.
 *
 * Non è una soglia di allarme: è la distanza oltre la quale vale la pena
 * **dirlo**, che è una cosa più mite.
 */
const STALE_AFTER_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export type DataFreshness =
  | { readonly kind: "not-applicable" }
  | { readonly kind: "never" }
  | { readonly kind: "fresh"; readonly at: Date; readonly hours: number }
  | { readonly kind: "stale"; readonly at: Date; readonly hours: number };

export type FreshnessInput = {
  readonly connector: ConnectorChoice | null;
  readonly lastSyncedAt: Date | null;
  readonly now: Date;
};

export function dataFreshness(input: FreshnessInput): DataFreshness {
  /*
   * Solo per una fonte che si legge dal portale.
   *
   * I dati di esempio si caricano da riga di comando e non hanno un «ultima
   * lettura» che significhi qualcosa: dire «mai letti» a un progetto
   * dimostrativo pieno di dati sarebbe falso, e dirlo a un progetto senza
   * connettore sarebbe rumore su una schermata che ha già i primi passi.
   */
  if (input.connector !== "jira") return { kind: "not-applicable" };

  if (input.lastSyncedAt === null) return { kind: "never" };

  const elapsed = input.now.getTime() - input.lastSyncedAt.getTime();

  /*
   * Un segnatempo nel futuro si tratta come «appena letto», non come un errore.
   *
   * Succede per un orologio sfasato di qualche minuto fra due macchine, ed è
   * un caso reale in cui la risposta giusta è tacere: «letto fra due ore» è la
   * forma più veloce di far perdere fiducia a un'intera schermata.
   */
  const hours = Math.max(0, Math.floor(elapsed / HOUR_MS));

  return hours >= STALE_AFTER_HOURS
    ? { kind: "stale", at: input.lastSyncedAt, hours }
    : { kind: "fresh", at: input.lastSyncedAt, hours };
}

/**
 * Da quanto tempo, detto come lo direbbe una persona.
 *
 * «36 ore» costringe chi legge a dividere; «un giorno e mezzo» no. Sopra la
 * settimana si smette di contare i giorni, perché a quel punto la cifra esatta
 * non cambia più ciò che si farà.
 */
export function describeAge(hours: number): string {
  if (hours < 1) return "meno di un'ora fa";
  if (hours === 1) return "un'ora fa";
  if (hours < 24) return `${hours} ore fa`;

  const days = Math.floor(hours / 24);

  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  if (days < 14) return "più di una settimana fa";

  return "più di due settimane fa";
}
