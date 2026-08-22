CREATE TYPE "public"."agent_language" AS ENUM('it', 'en');--> statement-breakpoint
CREATE TYPE "public"."agent_persona" AS ENUM('facilitator', 'flow_analyst', 'stakeholder_communicator');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."agent_tone" AS ENUM('neutral', 'concise', 'supportive', 'formal');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('observe', 'report', 'advise', 'act_with_approval', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('gemini', 'groq', 'fake');--> statement-breakpoint
CREATE TYPE "public"."skill_run_failure_cause" AS ENUM('budget_exceeded', 'quota_exceeded', 'provider_not_configured', 'provider_unavailable', 'rate_limited', 'timeout', 'invalid_output', 'agent_suspended');--> statement-breakpoint
CREATE TYPE "public"."skill_run_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."skill_trigger" AS ENUM('scheduled', 'event', 'on_demand');--> statement-breakpoint
CREATE TABLE "project_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_length_days" integer NOT NULL,
	"ceremonies" jsonb NOT NULL,
	"definition_of_done" jsonb NOT NULL,
	"working_agreement" text,
	"stakeholders" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_contexts_project_key" UNIQUE("project_id"),
	CONSTRAINT "project_contexts_sprint_length_days_check" CHECK ("project_contexts"."sprint_length_days" BETWEEN 1 AND 60),
	CONSTRAINT "project_contexts_definition_of_done_check" CHECK (jsonb_typeof("project_contexts"."definition_of_done") = 'array' AND jsonb_array_length("project_contexts"."definition_of_done") <= 20),
	CONSTRAINT "project_contexts_stakeholders_check" CHECK (jsonb_typeof("project_contexts"."stakeholders") = 'array' AND jsonb_array_length("project_contexts"."stakeholders") <= 20),
	CONSTRAINT "project_contexts_working_agreement_check" CHECK ("project_contexts"."working_agreement" IS NULL OR char_length("project_contexts"."working_agreement") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "scrum_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"persona" "agent_persona" NOT NULL,
	"tone" "agent_tone" NOT NULL,
	"language" "agent_language" NOT NULL,
	"autonomy_level" "autonomy_level" NOT NULL,
	"status" "agent_status" NOT NULL,
	"enabled_skill_keys" jsonb NOT NULL,
	"max_tokens_per_run" integer,
	"max_runs_per_day" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrum_agents_project_key" UNIQUE("project_id"),
	CONSTRAINT "scrum_agents_max_tokens_per_run_check" CHECK ("scrum_agents"."max_tokens_per_run" IS NULL OR ("scrum_agents"."max_tokens_per_run" > 0 AND "scrum_agents"."max_tokens_per_run" <= 100000)),
	CONSTRAINT "scrum_agents_max_runs_per_day_check" CHECK ("scrum_agents"."max_runs_per_day" > 0 AND "scrum_agents"."max_runs_per_day" <= 1000),
	CONSTRAINT "scrum_agents_enabled_skill_keys_check" CHECK (jsonb_typeof("scrum_agents"."enabled_skill_keys") = 'array')
);
--> statement-breakpoint
CREATE TABLE "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scrum_agent_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"trigger" "skill_trigger" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" "skill_run_status" NOT NULL,
	"failure_cause" "skill_run_failure_cause",
	"provider" "llm_provider",
	"model" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_runs_period_check" CHECK ("skill_runs"."finished_at" >= "skill_runs"."started_at"),
	CONSTRAINT "skill_runs_failure_cause_check" CHECK (("skill_runs"."status" = 'failed') = ("skill_runs"."failure_cause" IS NOT NULL)),
	CONSTRAINT "skill_runs_measures_check" CHECK ("skill_runs"."duration_ms" >= 0 AND "skill_runs"."input_tokens" >= 0 AND "skill_runs"."output_tokens" >= 0 AND "skill_runs"."estimated_cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_agents" ADD CONSTRAINT "scrum_agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_agents" ADD CONSTRAINT "scrum_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_scrum_agent_id_scrum_agents_id_fk" FOREIGN KEY ("scrum_agent_id") REFERENCES "public"."scrum_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_runs_project_started_idx" ON "skill_runs" USING btree ("organization_id","project_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "skill_runs_agent_started_idx" ON "skill_runs" USING btree ("scrum_agent_id","started_at" DESC NULLS LAST);