ALTER TYPE "public"."logistics_event_kind" ADD VALUE 'legacy';--> statement-breakpoint
ALTER TABLE "logistics_events" ADD COLUMN "sheet_actor" text;--> statement-breakpoint
ALTER TABLE "logistics_events" ADD COLUMN "sheet_link" text;--> statement-breakpoint
ALTER TABLE "logistics_events" ADD COLUMN "sheet_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_events_sheet_key" ON "logistics_events" USING btree ("sheet_key") WHERE "logistics_events"."sheet_key" is not null;--> statement-breakpoint
ALTER TABLE "logistics_events" ADD CONSTRAINT "logistics_events_sheet_link" CHECK ("logistics_events"."sheet_link" is null or "logistics_events"."sheet_link" ~ '^https://');