CREATE TABLE "doch1_report_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent_by" uuid DEFAULT app.current_user_id(),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doch1_report_sends_round_unit_day" UNIQUE("round_id","unit_id","day")
);
--> statement-breakpoint
ALTER TABLE "doch1_report_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doch1_report_sends" ADD CONSTRAINT "doch1_report_sends_round_id_doch1_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."doch1_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doch1_report_sends" ADD CONSTRAINT "doch1_report_sends_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doch1_report_sends_round_day_idx" ON "doch1_report_sends" USING btree ("round_id","day");--> statement-breakpoint
CREATE INDEX "doch1_report_sends_open_idx" ON "doch1_report_sends" USING btree ("notified_at");