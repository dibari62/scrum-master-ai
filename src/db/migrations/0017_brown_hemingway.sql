ALTER TABLE "project_contexts" ADD COLUMN "working_calendar" jsonb DEFAULT '{"workingDays":["monday","tuesday","wednesday","thursday","friday"],"holidays":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_working_calendar_check" CHECK (jsonb_typeof("project_contexts"."working_calendar" -> 'workingDays') = 'array'
        AND jsonb_array_length("project_contexts"."working_calendar" -> 'workingDays') BETWEEN 1 AND 7
        AND jsonb_typeof("project_contexts"."working_calendar" -> 'holidays') = 'array'
        AND jsonb_array_length("project_contexts"."working_calendar" -> 'holidays') <= 400);