CREATE TABLE "estimate_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_system" "source_system" NOT NULL,
	"source_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"from_value" integer,
	"from_unit" text,
	"to_value" integer,
	"to_unit" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_changes_source_key" UNIQUE("project_id","source_system","source_id")
);
--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_changes_item_occurred_idx" ON "estimate_changes" USING btree ("work_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "estimate_changes_project_occurred_idx" ON "estimate_changes" USING btree ("project_id","occurred_at");