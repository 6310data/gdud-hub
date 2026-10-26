ALTER TABLE "doch1_members" ADD COLUMN "released_on" date;--> statement-breakpoint
ALTER TABLE "doch1_members" ADD CONSTRAINT "doch1_members_service_dates" CHECK ("doch1_members"."released_on" >= "doch1_members"."call_up_on");--> statement-breakpoint
-- Same writers as call_up_on (doch1_members_update: admin / company user covering the soldier).
grant update (released_on) on public.doch1_members to authenticated;
