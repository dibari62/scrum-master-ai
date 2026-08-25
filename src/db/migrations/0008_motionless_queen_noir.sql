CREATE TYPE "public"."forecast_method" AS ENUM('yesterdays-weather', 'focus-factor', 'default-focus-factor');--> statement-breakpoint
CREATE TABLE "sprint_statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"forecast_points" real NOT NULL,
	"method" "forecast_method" NOT NULL,
	"focus_factor" real,
	"team_size" integer NOT NULL,
	"working_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_statistics_sprint_key" UNIQUE("sprint_id")
);
--> statement-breakpoint
ALTER TABLE "sprint_statistics" ADD CONSTRAINT "sprint_statistics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_statistics" ADD CONSTRAINT "sprint_statistics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_statistics" ADD CONSTRAINT "sprint_statistics_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_statistics_project_id_idx" ON "sprint_statistics" USING btree ("project_id");