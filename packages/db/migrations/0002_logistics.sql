CREATE TYPE "public"."logistics_condition" AS ENUM('ok', 'broken', 'brigade');--> statement-breakpoint
CREATE TYPE "public"."logistics_event_kind" AS ENUM('sign', 'return', 'transfer', 'condition', 'notes', 'serials_add', 'serial_remove', 'item_add', 'kit', 'store', 'release', 'holdings_form', 'person_add', 'person_update', 'person_remove');--> statement-breakpoint
CREATE TYPE "public"."logistics_form_kind" AS ENUM('signout', 'holdings');--> statement-breakpoint
CREATE TABLE "logistics_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"notes" text,
	"kit" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_by" uuid DEFAULT app.current_user_id(),
	"signer_name" text,
	"form_id" uuid,
	"returned_at" timestamp with time zone,
	"returned_to" "logistics_condition",
	"return_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "logistics_event_kind" NOT NULL,
	"actor_user_id" uuid DEFAULT app.current_user_id(),
	"actor_name" text,
	"person_id" uuid,
	"person_name" text,
	"item" text,
	"serial" text,
	"details" text,
	"form_id" uuid
);
--> statement-breakpoint
ALTER TABLE "logistics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "logistics_form_kind" NOT NULL,
	"person_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"subcategory" text,
	"sku" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_items_name_unique" UNIQUE("name"),
	CONSTRAINT "logistics_items_name_len" CHECK (length("logistics_items"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "logistics_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_kit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_kit_items_item_name" UNIQUE("item_id","name"),
	CONSTRAINT "logistics_kit_items_qty" CHECK ("logistics_kit_items"."qty" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "logistics_kit_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"category" text,
	"condition" "logistics_condition" DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_serials_serial_unique" UNIQUE("serial"),
	CONSTRAINT "logistics_serials_format" CHECK ("logistics_serials"."serial" ~ '^[^[:space:]]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "logistics_serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "logistics_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"serial_id" uuid,
	"item_name" text NOT NULL,
	"notes" text,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics_storage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "logistics_assignments" ADD CONSTRAINT "logistics_assignments_serial_id_logistics_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."logistics_serials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_assignments" ADD CONSTRAINT "logistics_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_assignments" ADD CONSTRAINT "logistics_assignments_form_id_logistics_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."logistics_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_events" ADD CONSTRAINT "logistics_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_events" ADD CONSTRAINT "logistics_events_form_id_logistics_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."logistics_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_forms" ADD CONSTRAINT "logistics_forms_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_kit_items" ADD CONSTRAINT "logistics_kit_items_item_id_logistics_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."logistics_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_serials" ADD CONSTRAINT "logistics_serials_item_id_logistics_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."logistics_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_storage" ADD CONSTRAINT "logistics_storage_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_storage" ADD CONSTRAINT "logistics_storage_serial_id_logistics_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."logistics_serials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_assignments_open_serial" ON "logistics_assignments" USING btree ("serial_id") WHERE "logistics_assignments"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "logistics_assignments_person_idx" ON "logistics_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "logistics_events_at_idx" ON "logistics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "logistics_events_person_idx" ON "logistics_events" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "logistics_forms_person_idx" ON "logistics_forms" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "logistics_serials_item_idx" ON "logistics_serials" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_storage_open_serial" ON "logistics_storage" USING btree ("serial_id") WHERE "logistics_storage"."released_at" is null and "logistics_storage"."serial_id" is not null;--> statement-breakpoint
CREATE INDEX "logistics_storage_person_idx" ON "logistics_storage" USING btree ("person_id");