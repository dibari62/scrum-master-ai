import {
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  type OrganizationRole,
  type Project,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { readProjectSettings, type SafeProjectSettings } from "@/db/project-settings";
import { auth } from "@/lib/auth";
import { mayConfigureSettings } from "@/lib/projects/settings";
import { secretsAvailable } from "@/lib/secrets";

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
   * Whether the installation can encrypt at all.
   *
   * Without `SECRETS_KEY` the form must not accept a key: storing it is
   * impossible, and pretending otherwise would lose it on submit — after the
   * person has already fetched it from a vendor's dashboard.
   */
  readonly custodyReady: boolean;
};

export async function loadSettings(slug: string): Promise<SettingsView | null> {
  const session = await auth();
  if (!session?.organizationId) return null;

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [row] = await scope.reads.projectBySlug(slug);
  if (!row) return null;

  const project = projectSchema.parse(row);

  const settings = await readProjectSettings(
    organizationId,
    projectIdSchema.parse(project.id),
  );

  return {
    project,
    settings,
    role: session.role ?? null,
    canConfigure: mayConfigureSettings(session.role),
    custodyReady: secretsAvailable(),
  };
}
