CREATE TABLE "doch1_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_locations_kind" CHECK ("doch1_locations"."kind" in ('outpost', 'camp', 'outside')),
	CONSTRAINT "doch1_locations_name_len" CHECK (length("doch1_locations"."name") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "doch1_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_standby_holders" (
	"team_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_standby_holders_team_id_unit_id_pk" PRIMARY KEY("team_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "doch1_standby_holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_standby_members" (
	"round_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_standby_members_team_id_person_id_pk" PRIMARY KEY("team_id","person_id"),
	CONSTRAINT "doch1_standby_members_role_len" CHECK (length(coalesce("doch1_standby_members"."role", '')) <= 30)
);
--> statement-breakpoint
ALTER TABLE "doch1_standby_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_standby_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"type_id" uuid,
	"name" text NOT NULL,
	"location_id" uuid,
	"vehicle_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_standby_teams_id_round" UNIQUE("id","round_id"),
	CONSTRAINT "doch1_standby_teams_name_len" CHECK (length("doch1_standby_teams"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_standby_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text DEFAULT 'company' NOT NULL,
	"size" integer,
	"required_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_standby_types_level" CHECK ("doch1_standby_types"."level" in ('battalion', 'company')),
	CONSTRAINT "doch1_standby_types_size" CHECK ("doch1_standby_types"."size" between 1 and 50),
	CONSTRAINT "doch1_standby_types_text_len" CHECK (length("doch1_standby_types"."name") between 1 and 30 and cardinality("doch1_standby_types"."required_roles") <= 10)
);
--> statement-breakpoint
ALTER TABLE "doch1_standby_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" text,
	"state" text DEFAULT 'ok' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_vehicles_number_unique" UNIQUE("number"),
	CONSTRAINT "doch1_vehicles_state" CHECK ("doch1_vehicles"."state" in ('ok', 'service', 'broken')),
	CONSTRAINT "doch1_vehicles_number" CHECK ("doch1_vehicles"."number" ~ '^[0-9A-Za-z-]{1,20}$'),
	CONSTRAINT "doch1_vehicles_text_len" CHECK (length(coalesce("doch1_vehicles"."kind", '')) <= 30 and length(coalesce("doch1_vehicles"."notes", '')) <= 200)
);
--> statement-breakpoint
ALTER TABLE "doch1_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_statuses" ADD COLUMN "standby_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doch1_locations" ADD CONSTRAINT "doch1_locations_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_holders" ADD CONSTRAINT "doch1_standby_holders_team_id_doch1_standby_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."doch1_standby_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_holders" ADD CONSTRAINT "doch1_standby_holders_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_members" ADD CONSTRAINT "doch1_standby_members_team_fk" FOREIGN KEY ("team_id","round_id") REFERENCES "public"."doch1_standby_teams"("id","round_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_members" ADD CONSTRAINT "doch1_standby_members_member_fk" FOREIGN KEY ("round_id","person_id") REFERENCES "public"."doch1_members"("round_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ADD CONSTRAINT "doch1_standby_teams_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ADD CONSTRAINT "doch1_standby_teams_type_id_doch1_standby_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doch1_standby_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ADD CONSTRAINT "doch1_standby_teams_location_id_doch1_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."doch1_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_teams" ADD CONSTRAINT "doch1_standby_teams_vehicle_id_doch1_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."doch1_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_standby_types" ADD CONSTRAINT "doch1_standby_types_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_locations_round_name" ON "doch1_locations" USING btree ("round_id","name");--> statement-breakpoint
CREATE INDEX "doch1_standby_holders_unit_idx" ON "doch1_standby_holders" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_standby_members_one_team" ON "doch1_standby_members" USING btree ("round_id","person_id");--> statement-breakpoint
CREATE INDEX "doch1_standby_teams_round_idx" ON "doch1_standby_teams" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_standby_types_round_name" ON "doch1_standby_types" USING btree ("round_id","name");--> statement-breakpoint
ALTER TABLE "doch1_members" ADD CONSTRAINT "doch1_members_location_id_doch1_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."doch1_locations"("id") ON DELETE set null ON UPDATE no action;