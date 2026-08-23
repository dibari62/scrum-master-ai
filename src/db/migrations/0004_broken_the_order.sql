CREATE TYPE "public"."report_origin" AS ENUM('model', 'code');--> statement-breakpoint
CREATE TABLE "sprint_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"scrum_agent_id" uuid NOT NULL,
	"skill_run_id" uuid NOT NULL,
	"origin" "report_origin" NOT NULL,
	"content" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_reports_origin_check" CHECK ("sprint_reports"."origin" <> 'code' OR jsonb_array_length("sprint_reports"."snapshot" -> 'values') = 0)
);
--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_scrum_agent_id_scrum_agents_id_fk" FOREIGN KEY ("scrum_agent_id") REFERENCES "public"."scrum_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_skill_run_id_skill_runs_id_fk" FOREIGN KEY ("skill_run_id") REFERENCES "public"."skill_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_reports_project_generated_idx" ON "sprint_reports" USING btree ("organization_id","project_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sprint_reports_sprint_idx" ON "sprint_reports" USING btree ("sprint_id","generated_at" DESC NULLS LAST);