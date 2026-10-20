CREATE TYPE "public"."module_id" AS ENUM('logistics', 'doch1', 'company', 'kesher', 'core');--> statement-breakpoint
CREATE TYPE "public"."unit_kind" AS ENUM('battalion', 'company', 'platoon', 'team');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"auth_user_id" uuid,
	"display_name" text,
	"person_id" uuid,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_email_unique" UNIQUE("email"),
	CONSTRAINT "app_users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_users_email_lower" CHECK ("app_users"."email" = lower("app_users"."email"))
);
--> statement-breakpoint
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"table_name" text NOT NULL,
	"row_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module" "module_id" NOT NULL,
	"role" text NOT NULL,
	"unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_module_unit" UNIQUE NULLS NOT DISTINCT("user_id","module","unit_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"personal_number" text,
	"phone" text,
	"role_title" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_personal_number_unique" UNIQUE("personal_number")
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" "unit_kind" NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code"),
	CONSTRAINT "units_code_format" CHECK ("units"."code" ~ '^[a-z0-9-]{1,32}$'),
	CONSTRAINT "units_color_format" CHECK ("units"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "units_no_self_parent" CHECK ("units"."parent_id" <> "units"."id")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_parent_id_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_unit_idx" ON "people" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "units_parent_idx" ON "units" USING btree ("parent_id");