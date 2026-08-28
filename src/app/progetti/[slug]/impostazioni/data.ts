import {
  DEFAULT_WORKING_CALENDAR,
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  workingCalendarSchema,
  type OrganizationRole,
  type Project,
  type WorkingCalendar,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { readProjectSettings, type SafeProjectSettings } from "@/db/project-settings";
import { auth } from "@/lib/auth";
import { mayConfigureSettings } from "@/lib/projects/settings";
import { secretsStatus, type SecretsStatus } from "@/lib/secrets";

/**
 * Ciò che la schermata delle impostazioni ha bisogno di sapere.
 *
 * Lettura sola, filtrata per organizzazione dall'helper condiviso (§8.4). I
 * segreti arrivano già ridotti a un indizio: `readProjectSettings` non restituisce
 * mai una chiave, quindi questa pagina non può stamparla nemmeno per errore.
 */

export type SettingsView = {
  readonly project: Project;
  readonly settings: SafeProjectSettings;
  readonly role: OrganizationRole | null;
  readonly canConfigure: boolean;

  /**
   * Whether the installation can encrypt at all, and why not when it cannot.
   *
   * Without `SECRETS_KEY` the form must not accept a key: storing it is
   * impossible, and pretending otherwise would lose it on submit — after the
   * person has already fetched it from a vendor's dashboard.
   *
   * **Uno stato e non un booleano**, perché «assente» e «incollata male» sono
   * due situazioni diverse e la seconda è quella in cui qualcuno ha già fatto
   * il lavoro giusto. Dirgli la stessa frase lo manda a rifarlo.
   */
  readonly custody: SecretsStatus;

  /**
   * Il calendario dichiarato dalla squadra, o il predefinito.
   *
   * Viene dal contesto di progetto, che nasce insieme allo Scrum Master AI: un
   * progetto senza agente non ha un contesto, e finché non ce l'ha il calendario
   * è quello predefinito — lunedì-venerdì, nessuna festività.
   */
  readonly calendar: WorkingCalendar;

  /** Se un contesto esiste: senza, il calendario si mostra ma non si salva. */
  readonly hasContext: boolean;
};

export async function loadSettings(slug: string): Promise<SettingsView | null> {
  const session = await auth();
  if (!session?.organizationId) return null;

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [row] = await scope.reads.projectBySlug(slug);
  if (!row) return null;

  const project = projectSchema.parse(row);
  const projectId = projectIdSchema.parse(project.id);

  const [settings, contextRows] = await Promise.all([
    readProjectSettings(organizationId, projectId),
    scope.reads.projectContextByProject(projectId),
  ]);

  return {
    project,
    settings,
    role: session.role ?? null,
    canConfigure: mayConfigureSettings(session.role),
    custody: secretsStatus(),
    calendar: contextRows[0]
      ? workingCalendarSchema.parse(contextRows[0].workingCalendar)
      : DEFAULT_WORKING_CALENDAR,
    hasContext: contextRows.length > 0,
  };
}
