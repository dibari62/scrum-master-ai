ALTER TABLE "project_contexts" ADD COLUMN "acceptance_thresholds" jsonb;--> statement-breakpoint
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_acceptance_thresholds_check" CHECK ("project_contexts"."acceptance_thresholds" IS NULL OR (
        jsonb_typeof("project_contexts"."acceptance_thresholds") = 'object'
        AND ("project_contexts"."acceptance_thresholds" ->> 'must')::int >= 0
        AND ("project_contexts"."acceptance_thresholds" ->> 'should')::int >= 0
        AND ("project_contexts"."acceptance_thresholds" ->> 'later')::int >= 0
      ));