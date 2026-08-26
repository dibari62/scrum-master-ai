CREATE TYPE "public"."improvement_status" AS ENUM('open', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."retrospective_column" AS ENUM('good', 'could-have-done-better', 'improvement');--> statement-breakpoint
CREATE TABLE "improvement_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"retrospective_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"status" "improvement_status" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrospective_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"retrospective_id" uuid NOT NULL,
	"column" "retrospective_column" NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrospectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"participant_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrospectives_sprint_key" UNIQUE("sprint_id")
);
--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_actions" ADD CONSTRAINT "improvement_actions_retrospective_id_retrospectives_id_fk" FOREIGN KEY ("retrospective_id") REFERENCES "public"."retrospectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospective_notes" ADD CONSTRAINT "retrospective_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospective_notes" ADD CONSTRAINT "retrospective_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospective_notes" ADD CONSTRAINT "retrospective_notes_retrospective_id_retrospectives_id_fk" FOREIGN KEY ("retrospective_id") REFERENCES "public"."retrospectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospectives" ADD CONSTRAINT "retrospectives_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospectives" ADD CONSTRAINT "retrospectives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrospectives" ADD CONSTRAINT "retrospectives_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "improvement_actions_retrospective_idx" ON "improvement_actions" USING btree ("retrospective_id");--> statement-breakpoint
CREATE INDEX "improvement_actions_project_status_idx" ON "improvement_actions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "retrospective_notes_retrospective_idx" ON "retrospective_notes" USING btree ("retrospective_id");--> statement-breakpoint
CREATE INDEX "retrospective_notes_project_id_idx" ON "retrospective_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "retrospectives_project_id_idx" ON "retrospectives" USING btree ("project_id");