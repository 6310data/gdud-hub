import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@gdud/db";
import { logisticsAccess } from "@/lib/logistics/access";
import { battalionName, loadHoldings, loadPerson } from "@/lib/logistics/data";
import { holdingsForm } from "@/lib/logistics/forms";
import { requireModule } from "@/lib/session";
import { FormDocument } from "../../../_components/form-document";
import { PrintButton } from "@/components/print-button";
import { SaveHoldingsButton } from "./save-holdings-button";

export const metadata = { title: "טופס ציוד חתום" };

export default async function HoldingsFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { signer = "" } = z.object({ signer: z.string().trim().max(80).optional().catch(undefined) }).parse(await searchParams);
  const s = await requireModule("logistics");

  const data = await withUser(s.claims, async (tx) => {
    const person = await loadPerson(tx, s.units, id);
    return person ? { person, holdings: await loadHoldings(tx, { personId: id }) } : null;
  });
  if (!data) notFound();
  const { person, holdings } = data;
  const form = holdingsForm({
    battalion: battalionName(s.units),
    person,
    issuedBy: s.user.displayName ?? s.user.email,
    signer,
    lines: holdings.map((h) => ({ item: h.itemName, serial: h.serial, kit: h.kit, notes: h.notes, signedAt: h.signedAt })),
  });
  const canSave = logisticsAccess(s).canAdminUnit(person.unitId) && holdings.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="tz-no-print flex flex-wrap items-center gap-3">
        <Link href={`/logistics/people?person=${person.id}`} className="tz-btn tz-btn-plain px-0">
          ‹ {person.name}
        </Link>
        <span className="flex-1" />
        <form className="flex items-center gap-2">
          <label className="tz-search bg-surface">
            <span className="sr-only">שם המאשר</span>
            <input name="signer" defaultValue={signer} placeholder="שם המאשר (לא חובה)" maxLength={80} />
          </label>
          <button className="tz-btn tz-btn-plain tz-btn-sm">עדכון</button>
        </form>
        <PrintButton variant={canSave ? "tinted" : "filled"} />
        {canSave ? <SaveHoldingsButton personId={person.id} signer={signer} /> : null}
      </div>
      <p className="tz-footnote tz-no-print m-0">
        {holdings.length} פריטים · הדפסה ← &quot;שמירה כ-PDF&quot; שומרת את הטופס כקובץ. &quot;שמירת הטופס&quot; מוסיפה אותו לטפסים של החייל.
      </p>
      <div className="overflow-x-auto rounded-group print:overflow-visible">
        <FormDocument data={form} kind="holdings" />
      </div>
    </div>
  );
}
