ALTER TABLE "doch1_standby_teams" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_vehicles" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ADD CONSTRAINT "doch1_standby_teams_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_vehicles" ADD CONSTRAINT "doch1_vehicles_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doch1_standby_teams_unit_idx" ON "doch1_standby_teams" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "doch1_vehicles_unit_idx" ON "doch1_vehicles" USING btree ("unit_id");