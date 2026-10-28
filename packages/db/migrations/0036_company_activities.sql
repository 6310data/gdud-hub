CREATE TABLE "company_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"day" date NOT NULL,
	"starts_at" time,
	"ends_at" time,
	"place" text,
	"commander_person_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_activities_times" CHECK ("company_activities"."ends_at" is null or "company_activities"."starts_at" is null or "company_activities"."ends_at" > "company_activities"."starts_at"),
	CONSTRAINT "company_activities_text_len" CHECK (length("company_activities"."name") between 1 and 80 and coalesce(length("company_activities"."place"), 0) <= 80 and coalesce(length("company_activities"."notes"), 0) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "company_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_activity_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_activity_participants_role_len" CHECK (coalesce(length("company_activity_participants"."role"), 0) <= 40)
);
--> statement-breakpoint
ALTER TABLE "company_activity_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_activity_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_activity_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_commander_person_id_people_id_fk" FOREIGN KEY ("commander_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activity_participants" ADD CONSTRAINT "company_activity_participants_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activity_participants" ADD CONSTRAINT "company_activity_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activity_vehicles" ADD CONSTRAINT "company_activity_vehicles_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activity_vehicles" ADD CONSTRAINT "company_activity_vehicles_vehicle_id_doch1_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."doch1_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_activities_unit_day_idx" ON "company_activities" USING btree ("unit_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "company_activity_participants_one" ON "company_activity_participants" USING btree ("activity_id","person_id");--> statement-breakpoint
CREATE INDEX "company_activity_participants_person_idx" ON "company_activity_participants" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_activity_vehicles_one" ON "company_activity_vehicles" USING btree ("activity_id","vehicle_id");