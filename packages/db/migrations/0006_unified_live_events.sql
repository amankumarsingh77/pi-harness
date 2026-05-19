CREATE TABLE IF NOT EXISTS "live_events" (
	"sequence" serial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "live_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_events" ADD CONSTRAINT "live_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_events" ADD CONSTRAINT "live_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_events_task_sequence_idx" ON "live_events" USING btree ("task_id","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_events_run_sequence_idx" ON "live_events" USING btree ("run_id","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_events_scope_sequence_idx" ON "live_events" USING btree ("scope","sequence");
