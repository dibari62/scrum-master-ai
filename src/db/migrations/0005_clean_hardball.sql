CREATE TYPE "public"."health_verdict" AS ENUM('respected', 'watch', 'critical', 'not-evaluable');--> statement-breakpoint
CREATE TABLE "sprint_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"taken_on" date NOT NULL,
	"verdict" "health_verdict" NOT NULL,
	"elapsed_fraction" real NOT NULL,
	"findings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_health_checks_day_key" UNIQUE("sprint_id","taken_on")
);
--> statement-breakpoint
ALTER TABLE "sprint_health_checks" ADD CONSTRAINT "sprint_health_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_health_checks" ADD CONSTRAINT "sprint_health_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_health_checks" ADD CONSTRAINT "sprint_health_checks_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_health_checks_sprint_idx" ON "sprint_health_checks" USING btree ("organization_id","sprint_id","taken_at" DESC NULLS LAST);