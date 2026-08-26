CREATE TYPE "public"."estimation_scale" AS ENUM('planning-poker', 'fibonacci', 'free');--> statement-breakpoint
ALTER TABLE "estimate_changes" ALTER COLUMN "from_value" SET DATA TYPE numeric(8, 2);--> statement-breakpoint
ALTER TABLE "estimate_changes" ALTER COLUMN "to_value" SET DATA TYPE numeric(8, 2);--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "estimate_value" SET DATA TYPE numeric(8, 2);--> statement-breakpoint
ALTER TABLE "project_contexts" ADD COLUMN "estimation_scale" "estimation_scale" DEFAULT 'free' NOT NULL;