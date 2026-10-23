-- The logistics sheet import's log row. Generated as 0004 on its branch and applied to the dev
-- database under that timestamp; renumbered after the doch1 migrations landed, keeping the
-- journal timestamp so databases that already have it don't run it again.
ALTER TYPE "public"."logistics_event_kind" ADD VALUE IF NOT EXISTS 'sheet_import';
