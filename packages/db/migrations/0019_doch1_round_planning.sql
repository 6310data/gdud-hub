CREATE TABLE "doch1_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"field" text NOT NULL,
	"name" text NOT NULL,
	"effect" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_field_options_round_id_key" UNIQUE("round_id","id"),
	CONSTRAINT "doch1_field_options_name_len" CHECK (length("doch1_field_options"."name") between 1 and 30),
	CONSTRAINT "doch1_field_options_effect" CHECK (("doch1_field_options"."field" = 'arrival' and "doch1_field_options"."effect" in ('arriving', 'not_arriving')) or ("doch1_field_options"."field" = 'enlistment' and "doch1_field_options"."effect" in ('arrived', 'pending', 'postponed', 'released')))
);
--> statement-breakpoint
ALTER TABLE "doch1_field_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doch1_import_mappings" DROP CONSTRAINT "doch1_import_mappings_kind";--> statement-breakpoint
-- Round state (hand-edited): state takes over from the active flag, which becomes generated from it.
-- Dropping "active" drops doch1_rounds_one_active with it; it is recreated on the generated column.
ALTER TABLE "doch1_rounds" ADD COLUMN "state" text DEFAULT 'closed' NOT NULL;--> statement-breakpoint
UPDATE "doch1_rounds" SET "state" = CASE WHEN "active" THEN 'active' ELSE 'closed' END;--> statement-breakpoint
ALTER TABLE "doch1_rounds" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "doch1_rounds" ADD COLUMN "active" boolean GENERATED ALWAYS AS (state = 'active') STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_rounds_one_active" ON "doch1_rounds" USING btree ("active") WHERE "doch1_rounds"."active";--> statement-breakpoint
ALTER TABLE "doch1_members" ADD COLUMN "arrival_option_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD COLUMN "enlistment_option_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD COLUMN "planned_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_reminder_requests" ADD COLUMN "kind" text DEFAULT 'report' NOT NULL;--> statement-breakpoint
ALTER TABLE "doch1_field_options" ADD CONSTRAINT "doch1_field_options_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_field_options_round_field_name" ON "doch1_field_options" USING btree ("round_id","field","name");--> statement-breakpoint
ALTER TABLE "doch1_members" ADD CONSTRAINT "doch1_members_planned_unit_id_units_id_fk" FOREIGN KEY ("planned_unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_rounds_one_planning" ON "doch1_rounds" USING btree ("state") WHERE "doch1_rounds"."state" = 'planning';--> statement-breakpoint
ALTER TABLE "doch1_import_mappings" ADD CONSTRAINT "doch1_import_mappings_kind" CHECK ("doch1_import_mappings"."kind" in ('company', 'platoon', 'status', 'location', 'arrival', 'enlistment'));--> statement-breakpoint
ALTER TABLE "doch1_reminder_requests" ADD CONSTRAINT "doch1_reminder_requests_kind" CHECK ("doch1_reminder_requests"."kind" in ('report', 'arrival'));--> statement-breakpoint
ALTER TABLE "doch1_rounds" ADD CONSTRAINT "doch1_rounds_state" CHECK ("doch1_rounds"."state" in ('planning', 'active', 'closed'));