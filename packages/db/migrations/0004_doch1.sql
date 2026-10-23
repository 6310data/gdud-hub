CREATE TABLE "doch1_brigade_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"day" date NOT NULL,
	"partial" boolean NOT NULL,
	"content" text NOT NULL,
	"sent_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_brigade_log_content_len" CHECK (length("doch1_brigade_log"."content") <= 20000)
);
--> statement-breakpoint
ALTER TABLE "doch1_brigade_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_days" (
	"round_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status_id" uuid NOT NULL,
	"updated_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_days_person_id_day_pk" PRIMARY KEY("person_id","day")
);
--> statement-breakpoint
ALTER TABLE "doch1_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_import_mappings" (
	"round_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_import_mappings_round_id_kind_source_key_pk" PRIMARY KEY("round_id","kind","source_key"),
	CONSTRAINT "doch1_import_mappings_kind" CHECK ("doch1_import_mappings"."kind" in ('company', 'platoon', 'status'))
);
--> statement-breakpoint
ALTER TABLE "doch1_import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_members" (
	"round_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"in_report" boolean DEFAULT true NOT NULL,
	"dmh_category" text,
	"arrival_forecast" text,
	"call_up_on" date,
	"enlistment_status" text,
	"has_disc" boolean,
	"notes" text,
	"sheet_tab" text,
	"sheet_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_members_round_id_person_id_pk" PRIMARY KEY("round_id","person_id"),
	CONSTRAINT "doch1_members_sheet_row" CHECK ("doch1_members"."sheet_row" > 0)
);
--> statement-breakpoint
ALTER TABLE "doch1_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "doch1_push_subscriptions_https" CHECK ("doch1_push_subscriptions"."endpoint" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "doch1_push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_reminder_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"unit_id" uuid,
	"user_id" uuid,
	"missing" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_reminder_log_kind" CHECK ("doch1_reminder_log"."kind" in ('daily', 'request'))
);
--> statement-breakpoint
ALTER TABLE "doch1_reminder_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_reminder_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"requested_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "doch1_reminder_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_round_companies" (
	"round_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"app_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_round_companies_round_id_unit_id_pk" PRIMARY KEY("round_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "doch1_round_companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"call_up_on" date,
	"reminder_at" time DEFAULT '09:00' NOT NULL,
	"lock_at" time DEFAULT '10:00' NOT NULL,
	"send_at" time DEFAULT '10:15' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_rounds_dates" CHECK ("doch1_rounds"."ends_on" >= "doch1_rounds"."starts_on"),
	CONSTRAINT "doch1_rounds_name_len" CHECK (length("doch1_rounds"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "doch1_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"display_group" text NOT NULL,
	"sheet_value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"counts_in_sadak" boolean DEFAULT false NOT NULL,
	"counts_as_present" boolean DEFAULT false NOT NULL,
	"home_day" boolean DEFAULT false NOT NULL,
	"org_day" boolean DEFAULT false NOT NULL,
	"general_day" boolean DEFAULT false NOT NULL,
	"off_duty" boolean DEFAULT false NOT NULL,
	"across_border" boolean DEFAULT false NOT NULL,
	"needs_outpost" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"replaces_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_statuses_color_format" CHECK ("doch1_statuses"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "doch1_statuses_sadak_or_off" CHECK (not ("doch1_statuses"."counts_in_sadak" and "doch1_statuses"."off_duty")),
	CONSTRAINT "doch1_statuses_text_len" CHECK (length("doch1_statuses"."name") between 1 and 30 and length("doch1_statuses"."display_group") between 1 and 30 and length("doch1_statuses"."sheet_value") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "doch1_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doch1_brigade_log" ADD CONSTRAINT "doch1_brigade_log_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_days" ADD CONSTRAINT "doch1_days_status_id_doch1_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."doch1_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_days" ADD CONSTRAINT "doch1_days_member_fk" FOREIGN KEY ("round_id","person_id") REFERENCES "public"."doch1_members"("round_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_import_mappings" ADD CONSTRAINT "doch1_import_mappings_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD CONSTRAINT "doch1_members_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD CONSTRAINT "doch1_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_push_subscriptions" ADD CONSTRAINT "doch1_push_subscriptions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_reminder_log" ADD CONSTRAINT "doch1_reminder_log_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_reminder_log" ADD CONSTRAINT "doch1_reminder_log_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_reminder_log" ADD CONSTRAINT "doch1_reminder_log_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_reminder_requests" ADD CONSTRAINT "doch1_reminder_requests_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_reminder_requests" ADD CONSTRAINT "doch1_reminder_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_round_companies" ADD CONSTRAINT "doch1_round_companies_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_round_companies" ADD CONSTRAINT "doch1_round_companies_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_statuses" ADD CONSTRAINT "doch1_statuses_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_statuses" ADD CONSTRAINT "doch1_statuses_replaces_id_doch1_statuses_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."doch1_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doch1_brigade_log_round_day_idx" ON "doch1_brigade_log" USING btree ("round_id","day");--> statement-breakpoint
CREATE INDEX "doch1_days_round_day_idx" ON "doch1_days" USING btree ("round_id","day");--> statement-breakpoint
CREATE INDEX "doch1_members_person_idx" ON "doch1_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "doch1_push_subscriptions_user_idx" ON "doch1_push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_reminder_log_daily_once" ON "doch1_reminder_log" USING btree ("round_id","day","user_id") WHERE "doch1_reminder_log"."kind" = 'daily';--> statement-breakpoint
CREATE INDEX "doch1_reminder_requests_open_idx" ON "doch1_reminder_requests" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_rounds_one_active" ON "doch1_rounds" USING btree ("active") WHERE "doch1_rounds"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_statuses_round_name" ON "doch1_statuses" USING btree ("round_id","name") WHERE "doch1_statuses"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_statuses_round_sheet_value" ON "doch1_statuses" USING btree ("round_id","sheet_value") WHERE "doch1_statuses"."active";