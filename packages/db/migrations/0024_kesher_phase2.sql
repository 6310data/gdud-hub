CREATE TYPE "public"."kesher_condition" AS ENUM('ok', 'broken');--> statement-breakpoint
ALTER TYPE "public"."kesher_event_kind" ADD VALUE 'brigade_in';--> statement-breakpoint
ALTER TYPE "public"."kesher_event_kind" ADD VALUE 'brigade_out';--> statement-breakpoint
ALTER TYPE "public"."kesher_event_kind" ADD VALUE 'repair';--> statement-breakpoint
ALTER TYPE "public"."kesher_event_kind" ADD VALUE 'eye_check';--> statement-breakpoint
ALTER TYPE "public"."kesher_event_kind" ADD VALUE 'vehicle_stock';--> statement-breakpoint
ALTER TYPE "public"."kesher_location" ADD VALUE 'brigade';--> statement-breakpoint
CREATE TABLE "kesher_eye_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" uuid DEFAULT app.current_user_id(),
	"by_name" text
);
--> statement-breakpoint
ALTER TABLE "kesher_eye_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kesher_vehicle_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kesher_vehicle_stock_vehicle_item" UNIQUE("vehicle_id","item_id"),
	CONSTRAINT "kesher_vehicle_stock_qty" CHECK ("kesher_vehicle_stock"."qty" between 1 and 9999)
);
--> statement-breakpoint
ALTER TABLE "kesher_vehicle_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kesher_items" ADD COLUMN "broken_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kesher_serials" ADD COLUMN "condition" "kesher_condition" DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD COLUMN "eye_warn_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD COLUMN "eye_alert_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD COLUMN "notify_missing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD COLUMN "reminder_hour" integer DEFAULT 9;--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD COLUMN "reminder_sent_on" date;--> statement-breakpoint
ALTER TABLE "kesher_eye_checks" ADD CONSTRAINT "kesher_eye_checks_serial_id_kesher_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."kesher_serials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_vehicle_stock" ADD CONSTRAINT "kesher_vehicle_stock_vehicle_id_doch1_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."doch1_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kesher_vehicle_stock" ADD CONSTRAINT "kesher_vehicle_stock_item_id_kesher_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."kesher_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kesher_eye_checks_serial_idx" ON "kesher_eye_checks" USING btree ("serial_id","at");--> statement-breakpoint
ALTER TABLE "kesher_items" ADD CONSTRAINT "kesher_items_broken_qty" CHECK ("kesher_items"."broken_qty" >= 0 and ("kesher_items"."kind" = 'bulk' or "kesher_items"."broken_qty" = 0));--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD CONSTRAINT "kesher_settings_eye_days" CHECK ("kesher_settings"."eye_warn_days" between 1 and 60 and "kesher_settings"."eye_alert_days" between "kesher_settings"."eye_warn_days" and 90);--> statement-breakpoint
ALTER TABLE "kesher_settings" ADD CONSTRAINT "kesher_settings_reminder_hour" CHECK ("kesher_settings"."reminder_hour" is null or "kesher_settings"."reminder_hour" between 0 and 23);