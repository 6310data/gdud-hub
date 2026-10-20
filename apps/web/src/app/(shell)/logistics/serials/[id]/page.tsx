import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CONDITION_LABEL, CONDITION_PLACE, kitToString, LOGISTICS_CONDITIONS } from "@gdud/core";
import { eq, schema, withUser } from "@gdud/db";
import { Field, Row, Section, Serial } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { logisticsAccess } from "@/lib/logistics/access";
import { loadHeldSerialIds, loadHoldings, loadPerson, loadSerialHistory, loadStorage, personPlace } from "@/lib/logistics/data";
import { fmtDate, fmtDateTime } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { updateHolding } from "../../_actions/signout";
import { removeSerial, setCondition } from "../../_actions/stock";
import { PageHeader, SerialChip } from "../../_components/ui";

export const metadata = { title: "צ׳" };

export default async function SerialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await requireModule("logistics");
  const access = logisticsAccess(s);

  const data = await withUser(s.claims, async (tx) => {
    const [row] = await tx
      .select({ serial: schema.logisticsSerials, item: schema.logisticsItems })
      .from(schema.logisticsSerials)
      .innerJoin(schema.logisticsItems, eq(schema.logisticsItems.id, schema.logisticsSerials.itemId))
      .where(eq(schema.logisticsSerials.id, id));
    if (!row) return null;
    const [held, [holding], history] = await Promise.all([loadHeldSerialIds(tx), loadHoldings(tx, { serialId: id }), loadSerialHistory(tx, id)]);
    const holder = holding ? await loadPerson(tx, s.units, holding.personId) : null;
    const stored = holding ? (await loadStorage(tx, { personId: holding.personId })).find((x) => x.serialId === id) : undefined;
    return { ...row, isHeld: held.has(id), holding, holder, stored, history: history.filter((h) => h.returnedAt) };
  });
  if (!data) notFound();
  const { serial, item, isHeld, holding, holder, stored, history } = data;
  const canAdminHolder = Boolean(holder && access.canAdminUnit(holder.unitId));

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <Link href={`/logistics/stock?item=${item.id}`} className="tz-btn tz-btn-plain self-start px-0">
        ‹ {item.name}
      </Link>
      <PageHeader
        title={item.name}
        sub={
          <>
            צ׳ <Serial>{serial.serial}</Serial>
          </>
        }
        actions={<SerialChip condition={serial.condition} held={isHeld} />}
      />

      <Section header="פרטים">
        <Row title="צ׳" value={<Serial>{serial.serial}</Serial>} />
        <Row title="קטגוריה" value={serial.category || item.category || "—"} />
        <Row title="מצב" trailing={<SerialChip condition={serial.condition} held={isHeld} />} />
        {holding && holder ? (
          <>
            <Row
              title="על שם"
              value={
                <Link href={`/logistics/people?person=${holder.id}`} className="font-semibold text-primary no-underline">
                  {holder.name}
                  {personPlace(holder) ? ` · ${personPlace(holder)}` : ""}
                </Link>
              }
            />
            <Row title="הוחתם" value={`${fmtDateTime(holding.signedAt)}${holding.signerName ? ` · ע״י ${holding.signerName}` : ""}`} />
            <Row title="ציוד משלים" value={kitToString(holding.kit) || "—"} />
            <Row title="הערות" value={holding.notes || "—"} />
            {holding.formId ? <Row title="טופס החתמה" value={<Link href={`/logistics/forms/${holding.formId}`}>פתיחה</Link>} /> : null}
            {stored ? <Row title="אפסון" trailing={<span className="tz-chip tz-chip-brigade">באפסון מ-{fmtDate(stored.storedAt)}</span>} /> : null}
          </>
        ) : isHeld ? (
          <Row title="על שם" value="מוחתם על חייל מחוץ למסגרת שלך" />
        ) : null}
      </Section>

      {holding && canAdminHolder ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href={`/logistics/return?person=${holding.personId}&assignment=${holding.id}`} className="tz-btn tz-btn-danger tz-btn-sm">
              זיכוי
            </Link>
            <Link href={`/logistics/sign?serial=${serial.id}`} className="tz-btn tz-btn-tinted tz-btn-sm">
              העברה לחייל אחר
            </Link>
          </div>
          <Section header="עדכון הערה וציוד משלים">
            <ActionForm action={updateHolding} submitLabel="שמירה" variant="tinted">
              <input type="hidden" name="assignmentId" value={holding.id} />
              <Field label="ציוד משלים (מופרד בפסיקים)">
                <input name="kit" className="tz-input" defaultValue={kitToString(holding.kit)} maxLength={500} />
              </Field>
              <Field label="הערות">
                <textarea name="notes" className="tz-input" rows={2} defaultValue={holding.notes ?? ""} maxLength={500} />
              </Field>
            </ActionForm>
          </Section>
        </>
      ) : null}

      {!isHeld && access.isAdmin ? (
        <Section header="פעולות" footer="רק צ׳ במצב תקין אפשר להחתים. מחיקה אפשרית רק לצ׳ שלא מוחתם.">
          {serial.condition === "ok" ? (
            <Row
              title="החתמה על חייל"
              trailing={
                <Link href={`/logistics/sign?serial=${serial.id}`} className="tz-btn tz-btn-filled tz-btn-sm">
                  החתמה
                </Link>
              }
            />
          ) : null}
          {access.isStockAdmin ? (
            <>
              <Row
                title="שינוי מצב"
                trailing={
                  <span className="flex flex-wrap gap-1.5 py-1">
                    {LOGISTICS_CONDITIONS.filter((c) => c !== serial.condition).map((c) => (
                      <ActionButton key={c} action={setCondition.bind(null, serial.id, c)} label={`ל${CONDITION_LABEL[c]}`} variant="tinted" />
                    ))}
                  </span>
                }
              />
              <Row title="מחיקת הצ׳ מהמלאי" trailing={<ActionButton action={removeSerial.bind(null, serial.id)} label="מחיקה" confirmLabel="לאשר מחיקה" />} />
            </>
          ) : null}
        </Section>
      ) : null}

      {history.length ? (
        <Section header="היסטוריה">
          {history.map((h) => (
            <Row
              key={h.id}
              title={<Link href={`/logistics/people?person=${h.personId}`}>{h.personName}</Link>}
              sub={[`${fmtDate(h.signedAt)} – ${fmtDate(h.returnedAt)}`, h.returnedTo ? CONDITION_PLACE[h.returnedTo] : null, h.returnNotes].filter(Boolean).join(" · ")}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}
