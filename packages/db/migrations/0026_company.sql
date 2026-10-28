CREATE TABLE "company_join_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_join_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"person_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"decision_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_join_requests_status" CHECK ("company_join_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "company_join_requests_text_len" CHECK (length("company_join_requests"."email") <= 320 and coalesce(length("company_join_requests"."display_name"), 0) <= 120)
);
--> statement-breakpoint
ALTER TABLE "company_join_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_profile_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"decision_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profile_requests_status" CHECK ("company_profile_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "company_profile_requests_field" CHECK ("company_profile_requests"."field" in ('full_name', 'role_title')),
	CONSTRAINT "company_profile_requests_text_len" CHECK (coalesce(length("company_profile_requests"."old_value"), 0) <= 120 and coalesce(length("company_profile_requests"."new_value"), 0) <= 120)
);
--> statement-breakpoint
ALTER TABLE "company_profile_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_join_requests" ADD CONSTRAINT "company_join_requests_decided_by_app_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_requests" ADD CONSTRAINT "company_profile_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_requests" ADD CONSTRAINT "company_profile_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_requests" ADD CONSTRAINT "company_profile_requests_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_requests" ADD CONSTRAINT "company_profile_requests_decided_by_app_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_join_attempts_user_idx" ON "company_join_attempts" USING btree ("auth_user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_join_requests_one_open" ON "company_join_requests" USING btree ("auth_user_id") WHERE "company_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "company_join_requests_unit_idx" ON "company_join_requests" USING btree ("unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_profile_requests_one_open" ON "company_profile_requests" USING btree ("person_id","field") WHERE "company_profile_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "company_profile_requests_unit_idx" ON "company_profile_requests" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "company_profile_requests_person_idx" ON "company_profile_requests" USING btree ("person_id","field","status");