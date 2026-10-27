CREATE TABLE "doch1_dmh_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"name" text NOT NULL,
	"listed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_dmh_categories_name_len" CHECK (length("doch1_dmh_categories"."name") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "doch1_dmh_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doch1_report_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"name" text NOT NULL,
	"commander" text,
	"unit_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_report_groups_text_len" CHECK (length("doch1_report_groups"."name") between 1 and 40 and length(coalesce("doch1_report_groups"."commander", '')) <= 60 and cardinality("doch1_report_groups"."unit_ids") <= 30)
);
--> statement-breakpoint
ALTER TABLE "doch1_report_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doch1_statuses" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "doch1_dmh_categories" ADD CONSTRAINT "doch1_dmh_categories_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_report_groups" ADD CONSTRAINT "doch1_report_groups_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_dmh_categories_round_name" ON "doch1_dmh_categories" USING btree ("round_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "doch1_report_groups_round_name" ON "doch1_report_groups" USING btree ("round_id","name");--> statement-breakpoint
ALTER TABLE "doch1_statuses" ADD CONSTRAINT "doch1_statuses_location_id_doch1_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."doch1_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ════════════════════════════════════════════════════════════════════════════
-- The reports screen's settings: privileges, RLS, the round guard, triggers.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("doch1 reports").
--
-- Who can do what:
--   דמ״ח categories, 10א report groups → battalion-wide doch1 admin (everyone in doch1 reads)
--   a status's camp (location_id)      → as the rest of the status: the admin (0005's statuses policies)
-- ════════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on public.doch1_dmh_categories, public.doch1_report_groups to authenticated;
--> statement-breakpoint

create policy doch1_dmh_categories_select on public.doch1_dmh_categories for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_dmh_categories_insert on public.doch1_dmh_categories for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_dmh_categories_update on public.doch1_dmh_categories for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_dmh_categories_delete on public.doch1_dmh_categories for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_report_groups_select on public.doch1_report_groups for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_report_groups_insert on public.doch1_report_groups for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_report_groups_update on public.doch1_report_groups for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_report_groups_delete on public.doch1_report_groups for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

-- A status's camp belongs to the same round. Not SECURITY DEFINER: locations are readable in doch1.
create or replace function app.doch1_status_location_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.location_id is not null
     and (select l.round_id from public.doch1_locations l where l.id = new.location_id) is distinct from new.round_id then
    raise exception 'location belongs to another round' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.doch1_status_location_guard() from public;
--> statement-breakpoint
create trigger doch1_statuses_location_guard before insert or update of location_id, round_id on public.doch1_statuses for each row execute function app.doch1_status_location_guard();
--> statement-breakpoint

create trigger doch1_dmh_categories_touch before update on public.doch1_dmh_categories for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_report_groups_touch before update on public.doch1_report_groups for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_dmh_categories_audit after insert or update or delete on public.doch1_dmh_categories for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_report_groups_audit after insert or update or delete on public.doch1_report_groups for each row execute function app.audit();
