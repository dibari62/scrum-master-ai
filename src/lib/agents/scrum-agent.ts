import { randomUUID } from "node:crypto";

import {
  createScrumAgentInputSchema,
  projectContextSchema,
  scrumAgentIdSchema,
  scrumAgentSchema,
  type CreateScrumAgentInput,
  type OrganizationId,
  type OrganizationRole,
  type ProjectContext,
  type ProjectId,
  type ScrumAgent,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { projectContextStructures, scrumAgentPolicy } from "@/db/rows";
import { projectContexts, scrumAgents } from "@/db/schema";

/**
 * Creating and reading the Scrum Master AI of a project.
 *
 * Lives in `src/lib` rather than beside a page because two entry points need
 * it — the wizard that creates and the card that shows — and a rule duplicated
 * across two callers is a rule that will eventually differ between them.
 */

export type CreateOutcome =
  | { readonly ok: true; readonly agent: ScrumAgent }
  | {
      readonly ok: false;
      readonly reason: "forbidden" | "already-exists" | "project-archived" | "invalid" | "unknown";
      readonly message: string;
    };

/**
 * Who may configure the agent (open question Q4).
 *
 * Decided restrictively in the Product Owner's absence, and the asymmetry is
 * the argument: granting a permission later disturbs nobody, revoking one takes
 * something away from whoever had started using it. The configuration also
 * decides what the system will say to stakeholders, which puts it closer to a
 * setting than to a daily operation.
 */
const MAY_CONFIGURE: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);

export function mayConfigureAgent(role: OrganizationRole | null | undefined): boolean {
  return role !== null && role !== undefined && MAY_CONFIGURE.has(role);
}

export type AgentWithContext = {
  readonly agent: ScrumAgent;
  readonly context: ProjectContext | null;
};

/**
 * Reads the agent of a project, with its context.
 *
 * Returns `null` when there is none **or** when the caller's organization does
 * not own it: the two are deliberately indistinguishable, so a wrong scope
 * cannot confirm that something exists elsewhere (§8.4).
 */
export async function loadAgent(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<AgentWithContext | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [agentRow] = await scope.reads.scrumAgentByProject(projectId);
  if (!agentRow) return null;

  const [contextRow] = await scope.reads.projectContextByProject(projectId);

  return {
    agent: scrumAgentSchema.parse({ ...agentRow, policy: scrumAgentPolicy(agentRow) }),
    context: contextRow
      ? projectContextSchema.parse({
          ...contextRow,
          ...projectContextStructures(contextRow),
        })
      : null,
  };
}

/**
 * Creates the agent and its project context together.
 *
 * `db.batch`, not `db.transaction`: the Neon HTTP driver has no interactive
 * transactions but does send a batch as one server-side transaction. That is
 * why the identifiers are generated here instead of read back from `DEFAULT` —
 * the same shape as `createOrganizationWithOwner`, and the same reason.
 *
 * Atomicity is not a nicety here (criterio 3): an agent without its context
 * would render a card missing half its fields, and a context without an agent
 * would be invisible while still blocking the next attempt on the unique
 * constraint.
 */
export async function createAgent(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly role: OrganizationRole | null | undefined;
  readonly payload: CreateScrumAgentInput;
}): Promise<CreateOutcome> {
  if (!mayConfigureAgent(input.role)) {
    return {
      ok: false,
      reason: "forbidden",
      message: "Solo un amministratore può creare lo Scrum Master AI di un progetto.",
    };
  }

  const db = getDatabase();
  const scope = forOrganization(db, input.organizationId);

  const [project] = await scope.reads.projectById(input.projectId);
  if (!project) {
    // The same answer as "not yours": that a project exists in another tenant
    // is not something an error message should confirm.
    return { ok: false, reason: "forbidden", message: "Progetto non trovato." };
  }

  if (project.status === "archived") {
    return {
      ok: false,
      reason: "project-archived",
      message: "Il progetto è archiviato: non è possibile creare uno Scrum Master AI.",
    };
  }

  const [existing] = await scope.reads.scrumAgentByProject(input.projectId);
  if (existing) {
    return {
      ok: false,
      reason: "already-exists",
      message: "Questo progetto ha già uno Scrum Master AI.",
    };
  }

  const agentId = randomUUID();
  const now = new Date();
  const scoped = { organizationId: input.organizationId, projectId: input.projectId };

  try {
    await db.batch([
      db.insert(scrumAgents).values({
        id: agentId,
        ...scoped,
        name: input.payload.name,
        persona: input.payload.persona,
        tone: input.payload.tone,
        language: input.payload.language,
        autonomyLevel: input.payload.autonomyLevel,
        status: "active",
        enabledSkillKeys: [...input.payload.enabledSkillKeys],
        maxTokensPerRun: input.payload.policy.maxTokensPerRun,
        maxRunsPerDay: input.payload.policy.maxRunsPerDay,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(projectContexts).values({
        id: randomUUID(),
        ...scoped,
        sprintLengthDays: input.payload.context.sprintLengthDays,
        ceremonies: input.payload.context.ceremonies,
        definitionOfDone: [...input.payload.context.definitionOfDone],
        workingAgreement: input.payload.context.workingAgreement,
        stakeholders: [...input.payload.context.stakeholders],
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  } catch (error) {
    /*
     * The unique constraint is the real guard, not the read above.
     *
     * Two identical submissions milliseconds apart both pass that read and both
     * reach the insert; only the database can settle which one wins (criterio
     * 4). Reading the failure as "already exists" turns a race into the outcome
     * the person expected anyway.
     */
    const message = error instanceof Error ? error.message : String(error);

    if (/scrum_agents_project_key|project_contexts_project_key/.test(message)) {
      return {
        ok: false,
        reason: "already-exists",
        message: "Questo progetto ha già uno Scrum Master AI.",
      };
    }

    return { ok: false, reason: "unknown", message };
  }

  return {
    ok: true,
    agent: scrumAgentSchema.parse({
      id: scrumAgentIdSchema.parse(agentId),
      ...scoped,
      name: input.payload.name,
      persona: input.payload.persona,
      tone: input.payload.tone,
      language: input.payload.language,
      autonomyLevel: input.payload.autonomyLevel,
      status: "active",
      enabledSkillKeys: [...input.payload.enabledSkillKeys],
      policy: input.payload.policy,
      createdAt: now,
      updatedAt: now,
    }),
  };
}

/**
 * Turns the wizard's form into a validated payload.
 *
 * Everything but the name carries a default, which is what makes the wizard
 * completable without typing anything (criteri 8 and 31). A field left out of
 * the form is left out of the object too, so the schema supplies the default
 * rather than the form having to know it.
 */
export function parseWizardForm(form: FormData): CreateScrumAgentInput | null {
  const optional = (key: string): string | undefined => {
    const value = form.get(key);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const sprintLength = optional("sprintLengthDays");

  const parsed = createScrumAgentInputSchema.safeParse({
    name: form.get("name"),
    persona: optional("persona"),
    tone: optional("tone"),
    language: optional("language"),
    autonomyLevel: optional("autonomyLevel"),
    context: sprintLength === undefined ? {} : { sprintLengthDays: Number(sprintLength) },
  });

  return parsed.success ? parsed.data : null;
}
