import type { OrganizationId, ProjectId } from "@/domain";
import { readProjectSettings, revealProjectSecret } from "@/db/project-settings";
import { createGateway, type Gateway } from "@/lib/llm";

/**
 * Il gateway di **questo** progetto, con la chiave che il suo cliente ha portato.
 *
 * ADR-0010: la credenziale del modello appartiene a chi usa il portale. Da qui
 * discende una cosa che va detta chiaramente, perché è facile scriverla male:
 * **non esiste più un gateway dell'applicazione**. Ogni esecuzione di una skill
 * appartiene a un progetto, e quel progetto ha il proprio fornitore, il proprio
 * modello e la propria quota.
 *
 * Un gateway costruito una volta all'avvio e riusato servirebbe il rapporto di
 * un'azienda con la chiave di un'altra — e nessun test lo noterebbe, perché il
 * testo prodotto sarebbe corretto. Il difetto comparirebbe sulla fattura di
 * qualcun altro.
 *
 * L'ambiente resta il ripiego per lo sviluppo locale: un progetto che non ha
 * dichiarato nulla usa il fornitore finto, che non chiama nessuno.
 */
export async function gatewayForProject(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<Gateway> {
  const settings = await readProjectSettings(organizationId, projectId);

  /*
   * Il fornitore finto non ha bisogno di una chiave, e chiederla costerebbe una
   * decifratura per nulla.
   */
  if (settings.brainProvider === "fake") {
    return createGateway({
      credentials: { provider: "fake", apiKey: null, model: null },
    });
  }

  const apiKey = await revealProjectSecret(organizationId, projectId, "brain");

  return createGateway({
    credentials: {
      provider: settings.brainProvider,
      /*
       * `null` quando la chiave manca **o non è leggibile**.
       *
       * Le due cose si trattano uguali di proposito: se `SECRETS_KEY` è
       * cambiata, ogni chiave di ogni progetto è illeggibile insieme, e da qui
       * non c'è nulla da fare che sia diverso dal caso «non configurata». Il
       * gateway salterà il fornitore e la capacità fallirà con
       * `provider_not_configured`, che è ciò che di fatto è.
       */
      apiKey,
      model: settings.brainModel,
    },
  });
}
