CREATE TYPE "public"."connector_choice" AS ENUM('seed', 'github', 'jira');--> statement-breakpoint
CREATE TABLE "project_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connector" "connector_choice",
	"connector_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connector_secret" text,
	"connector_secret_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"brain_provider" "llm_provider" DEFAULT 'fake' NOT NULL,
	"brain_model" text,
	"brain_api_key" text,
	"brain_api_key_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_settings_project_key" UNIQUE("project_id"),
	CONSTRAINT "project_settings_connector_secret_sealed" CHECK ("project_settings"."connector_secret" IS NULL OR "project_settings"."connector_secret" LIKE 'v1.%'),
	CONSTRAINT "project_settings_brain_api_key_sealed" CHECK ("project_settings"."brain_api_key" IS NULL OR "project_settings"."brain_api_key" LIKE 'v1.%'),
	CONSTRAINT "project_settings_connector_secret_dated" CHECK (("project_settings"."connector_secret" IS NULL) = ("project_settings"."connector_secret_updated_at" IS NULL)),
	CONSTRAINT "project_settings_brain_api_key_dated" CHECK (("project_settings"."brain_api_key" IS NULL) = ("project_settings"."brain_api_key_updated_at" IS NULL)),
	CONSTRAINT "project_settings_brain_model_check" CHECK ("project_settings"."brain_model" IS NULL OR char_length("project_settings"."brain_model") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;