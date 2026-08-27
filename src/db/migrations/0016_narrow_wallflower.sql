ALTER TABLE "skill_runs" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project_settings" ALTER COLUMN "brain_provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project_settings" ALTER COLUMN "brain_provider" SET DEFAULT 'fake'::text;--> statement-breakpoint
DROP TYPE "public"."llm_provider";--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('fake', 'gemini', 'openai', 'anthropic', 'mistral', 'groq', 'openrouter', 'ollama');--> statement-breakpoint
ALTER TABLE "skill_runs" ALTER COLUMN "provider" SET DATA TYPE "public"."llm_provider" USING "provider"::"public"."llm_provider";--> statement-breakpoint
ALTER TABLE "project_settings" ALTER COLUMN "brain_provider" SET DEFAULT 'fake'::"public"."llm_provider";--> statement-breakpoint
ALTER TABLE "project_settings" ALTER COLUMN "brain_provider" SET DATA TYPE "public"."llm_provider" USING "brain_provider"::"public"."llm_provider";--> statement-breakpoint
ALTER TABLE "project_settings" ADD COLUMN "brain_base_url" text;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_brain_base_url_check" CHECK ("project_settings"."brain_base_url" IS NULL OR "project_settings"."brain_base_url" ~ '^https?://');