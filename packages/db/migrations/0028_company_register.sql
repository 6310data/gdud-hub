CREATE TABLE "company_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"serial" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_items_serial_format" CHECK ("company_items"."serial" is null or "company_items"."serial" ~ '^[^[:space:]]{1,40}$'),
	CONSTRAINT "company_items_quantity" CHECK (case when "company_items"."serial" is null then "company_items"."quantity" between 1 and 9999 else "company_items"."quantity" = 1 end),
	CONSTRAINT "company_items_text_len" CHECK (length("company_items"."name") between 1 and 80 and coalesce(length("company_items"."category"), 0) <= 40 and coalesce(length("company_items"."notes"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "company_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_signings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"company_item_id" uuid,
	"kesher_serial_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"single" boolean DEFAULT true NOT NULL,
	"from_person_id" uuid,
	"to_person_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_by" uuid,
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_signings_one_thing" CHECK (("company_signings"."company_item_id" is null) <> ("company_signings"."kesher_serial_id" is null)),
	CONSTRAINT "company_signings_quantity" CHECK ("company_signings"."quantity" between 1 and 9999 and (not "company_signings"."single" or "company_signings"."quantity" = 1))
);
--> statement-breakpoint
ALTER TABLE "company_signings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_items" ADD CONSTRAINT "company_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_company_item_id_company_items_id_fk" FOREIGN KEY ("company_item_id") REFERENCES "public"."company_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_kesher_serial_id_kesher_serials_id_fk" FOREIGN KEY ("kesher_serial_id") REFERENCES "public"."kesher_serials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_from_person_id_people_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_signed_by_app_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_signings" ADD CONSTRAINT "company_signings_returned_by_app_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_items_unit_serial" ON "company_items" USING btree ("unit_id","serial") WHERE "company_items"."serial" is not null;--> statement-breakpoint
CREATE INDEX "company_items_unit_idx" ON "company_items" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_signings_open_kesher" ON "company_signings" USING btree ("kesher_serial_id") WHERE "company_signings"."returned_at" is null and "company_signings"."kesher_serial_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_signings_open_single_item" ON "company_signings" USING btree ("company_item_id") WHERE "company_signings"."returned_at" is null and "company_signings"."single" and "company_signings"."company_item_id" is not null;--> statement-breakpoint
CREATE INDEX "company_signings_unit_idx" ON "company_signings" USING btree ("unit_id","returned_at");--> statement-breakpoint
CREATE INDEX "company_signings_to_idx" ON "company_signings" USING btree ("to_person_id");--> statement-breakpoint
CREATE INDEX "company_signings_from_idx" ON "company_signings" USING btree ("from_person_id");