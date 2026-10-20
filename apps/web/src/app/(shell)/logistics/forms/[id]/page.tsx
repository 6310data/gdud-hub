import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { eq, schema, withUser } from "@gdud/db";
import { requireModule } from "@/lib/session";
import { FormDocument } from "../../_components/form-document";
import { PrintButton } from "../../_components/print-button";

export const metadata = { title: "טופס" };

export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { done } = await searchParams;
  const s = await requireModule("logistics");
  const [form] = await withUser(s.claims, (tx) =>
    tx.select().from(schema.logisticsForms).where(eq(schema.logisticsForms.id, id)).limit(1),
  );
  if (!form) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="tz-no-print flex flex-wrap items-center gap-3">
        <Link href={`/logistics/people?person=${form.personId}`} className="tz-btn tz-btn-plain px-0">
          ‹ {form.data.person.name}
        </Link>
        <span className="flex-1" />
        <PrintButton />
      </div>
      {done === "1" ? (
        <p role="status" className="tz-alert tz-alert-ok tz-no-print m-0">
          {form.kind === "signout"
            ? `ההחתמה בוצעה: ${form.data.lines.length} פריטים על ${form.data.person.name}. הטופס נשמר — אפשר להדפיס או לשמור כ-PDF.`
            : "הטופס נשמר."}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-group print:overflow-visible">
        <FormDocument data={form.data} kind={form.kind} />
      </div>
    </div>
  );
}
