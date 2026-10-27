-- צפי הגעה / סטטוס גיוס live in doch1_field_options now (0019/0020 backfilled them); the import writes the option ids.
ALTER TABLE "doch1_members" DROP COLUMN "arrival_forecast";--> statement-breakpoint
ALTER TABLE "doch1_members" DROP COLUMN "enlistment_status";
