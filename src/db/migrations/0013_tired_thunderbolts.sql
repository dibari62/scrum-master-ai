CREATE TYPE "public"."scope_change_reason" AS ENUM('planned', 'unplanned');--> statement-breakpoint
ALTER TABLE "sprint_scope_events" ADD COLUMN "reason" "scope_change_reason";