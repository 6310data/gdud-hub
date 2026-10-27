CREATE TYPE "public"."kesher_event_kind" AS ENUM('sign', 'credit', 'intake', 'assign', 'stock_edit', 'serial_edit', 'kit_edit', 'check', 'import', 'legacy');--> statement-breakpoint
CREATE TYPE "public"."kesher_item_kind" AS ENUM('serial', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."kesher_location" AS ENUM('warehouse', 'company', 'none');--> statement-breakpoint
CREATE TABLE "kesher_check_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"serial_id" uuid,
	"serial" text NOT NULL,
	"item" text,
	"found" boolean NOT NULL,
	CONSTRAINT "kesher_check_lines_check_serial" UNIQUE("check_id","serial")
);
--> statement-breakpoint
ALTER TABLE "kesher_check_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" uuid DEFAULT app.current_user_id(),
	"reporter_name" text,
	"total" integer NOT NULL,
	"found" integer NOT NULL,
	"note" text,
	"notified_at" timestamp with time zone,
	"sheet_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_checks_counts" CHECK ("kesher_checks"."total" >= 0 and "kesher_checks"."found" between 0 and "kesher_checks"."total"),
	CONSTRAINT "kesher_checks_text_len" CHECK (coalesce(length("kesher_checks"."note"), 0) <= 1000 and coalesce(length("kesher_checks"."reporter_name"), 0) <= 120)
);
--> statement-breakpoint
ALTER TABLE "kesher_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "kesher_event_kind" NOT NULL,
	"actor_user_id" uuid DEFAULT app.current_user_id(),
	"actor_name" text,
	"unit_id" uuid,
	"company" text,
	"person_id" uuid,
	"person_name" text,
	"person_role" text,
	"item" text,
	"serial" text,
	"qty" integer,
	"details" text,
	"backdated" boolean DEFAULT false NOT NULL,
	"sheet_actor" text,
	"sheet_key" text
);
--> statement-breakpoint
ALTER TABLE "kesher_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_holders" (
	"serial_id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"signer_person_id" uuid,
	"signer_role" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_by" uuid DEFAULT app.current_user_id(),
	"holder_person_id" uuid,
	"holder_role" text,
	"frame" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_holders_text_len" CHECK (coalesce(length("kesher_holders"."signer_role"), 0) <= 40 and coalesce(length("kesher_holders"."holder_role"), 0) <= 40 and coalesce(length("kesher_holders"."frame"), 0) <= 40)
);
--> statement-breakpoint
ALTER TABLE "kesher_holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "kesher_item_kind" NOT NULL,
	"category" text,
	"brigade_qty" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_items_name_unique" UNIQUE("name"),
	CONSTRAINT "kesher_items_name_len" CHECK (length("kesher_items"."name") between 1 and 80),
	CONSTRAINT "kesher_items_brigade_qty" CHECK ("kesher_items"."brigade_qty" is null or ("kesher_items"."kind" = 'bulk' and "kesher_items"."brigade_qty" >= 0))
);
--> statement-breakpoint
ALTER TABLE "kesher_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_kit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_item_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_kit_items_parent_item" UNIQUE("parent_item_id","item_id"),
	CONSTRAINT "kesher_kit_items_qty" CHECK ("kesher_kit_items"."qty" between 1 and 99),
	CONSTRAINT "kesher_kit_items_not_self" CHECK ("kesher_kit_items"."parent_item_id" <> "kesher_kit_items"."item_id")
);
--> statement-breakpoint
ALTER TABLE "kesher_kit_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"location" "kesher_location" DEFAULT 'warehouse' NOT NULL,
	"unit_id" uuid,
	"vehicle" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_serials_serial_unique" UNIQUE("serial"),
	CONSTRAINT "kesher_serials_format" CHECK ("kesher_serials"."serial" ~ '^[^[:space:]]{1,40}$'),
	CONSTRAINT "kesher_serials_company" CHECK (("kesher_serials"."unit_id" is not null) = ("kesher_serials"."location" = 'company')),
	CONSTRAINT "kesher_serials_text_len" CHECK (coalesce(length("kesher_serials"."vehicle"), 0) <= 40 and coalesce(length("kesher_serials"."notes"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "kesher_serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"warehouse_tracked" boolean DEFAULT true NOT NULL,
	"check_stale_days" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_settings_single" CHECK ("kesher_settings"."id" = 1),
	CONSTRAINT "kesher_settings_stale_days" CHECK ("kesher_settings"."check_stale_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "kesher_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid,
	"qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_stock_item_unit" UNIQUE NULLS NOT DISTINCT("item_id","unit_id"),
	CONSTRAINT "kesher_stock_company_qty" CHECK ("kesher_stock"."unit_id" is null or "kesher_stock"."qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "kesher_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kesher_check_lines" ADD CONSTRAINT "kesher_check_lines_check_id_kesher_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."kesher_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_check_lines" ADD CONSTRAINT "kesher_check_lines_serial_id_kesher_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."kesher_serials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_checks" ADD CONSTRAINT "kesher_checks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_events" ADD CONSTRAINT "kesher_events_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_events" ADD CONSTRAINT "kesher_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_holders" ADD CONSTRAINT "kesher_holders_serial_id_kesher_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."kesher_serials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_holders" ADD CONSTRAINT "kesher_holders_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_holders" ADD CONSTRAINT "kesher_holders_signer_person_id_people_id_fk" FOREIGN KEY ("signer_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_holders" ADD CONSTRAINT "kesher_holders_holder_person_id_people_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_kit_items" ADD CONSTRAINT "kesher_kit_items_parent_item_id_kesher_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."kesher_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_kit_items" ADD CONSTRAINT "kesher_kit_items_item_id_kesher_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."kesher_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_serials" ADD CONSTRAINT "kesher_serials_item_id_kesher_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."kesher_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_serials" ADD CONSTRAINT "kesher_serials_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_stock" ADD CONSTRAINT "kesher_stock_item_id_kesher_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."kesher_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_stock" ADD CONSTRAINT "kesher_stock_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kesher_check_lines_serial_idx" ON "kesher_check_lines" USING btree ("serial_id","check_id");--> statement-breakpoint
CREATE INDEX "kesher_checks_unit_at_idx" ON "kesher_checks" USING btree ("unit_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "kesher_checks_sheet_key" ON "kesher_checks" USING btree ("sheet_key") WHERE "kesher_checks"."sheet_key" is not null;--> statement-breakpoint
CREATE INDEX "kesher_events_at_idx" ON "kesher_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "kesher_events_unit_idx" ON "kesher_events" USING btree ("unit_id","at");--> statement-breakpoint
CREATE INDEX "kesher_events_serial_idx" ON "kesher_events" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "kesher_events_sheet_key" ON "kesher_events" USING btree ("sheet_key") WHERE "kesher_events"."sheet_key" is not null;--> statement-breakpoint
CREATE INDEX "kesher_holders_unit_idx" ON "kesher_holders" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "kesher_holders_signer_idx" ON "kesher_holders" USING btree ("signer_person_id");--> statement-breakpoint
CREATE INDEX "kesher_holders_holder_idx" ON "kesher_holders" USING btree ("holder_person_id");--> statement-breakpoint
CREATE INDEX "kesher_serials_item_idx" ON "kesher_serials" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "kesher_serials_unit_idx" ON "kesher_serials" USING btree ("unit_id");