import Link from "next/link";
import { can } from "@gdud/auth";
import { israelToday } from "@gdud/core";
import { and, eq, isNull, schema, withUser } from "@gdud/db";
import { ActionButton } from "@/components/action-button";
import { loadActiveRound, loadFieldOptions, loadMembers, loadRoundCompanies } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { fillCallUpFromReports } from "../_actions/members";
import { SoldiersBoard, type SoldierVM } from "./_components/soldiers-board";

const { doch1Members: members, doch1Days: days, doch1Statuses: statuses } = schema;

export const metadata = { title: "דוח 1 · חיילים" };

/**
 * חיילים: every soldier of the round with their call-up and release dates (תאריך גיוס / שחרור);
 * a row opens the soldier card (soldiers/[personId]).
 * A soldier is listed in every day screen only from the call-up date through the release date;
 * without a call-up date, nowhere — this is where those dates are entered.
 */
export default async function Doch1Soldiers({ searchParams }: { searchParams: Promise<{ unit?: string; show?: string }> }) {
  const s = await requireModule("doch1");
  const sp = await searchParams;

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const [companies, roster, options, reported] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadFieldOptions(tx, round.id),
      // soldiers without a call-up date who already showed up (a day in the סד״כ)
      tx
        .selectDistinct({ personId: days.personId })
        .from(days)
        .innerJoin(members, and(eq(members.roundId, days.roundId), eq(members.personId, days.personId)))
        .innerJoin(statuses, eq(statuses.id, days.statusId))
        .where(and(eq(days.roundId, round.id), isNull(members.callUpOn), eq(statuses.countsInSadak, true))),
    ]);
    return { round, companies, members: roster, options, reported: new Set(reported.map((r) => r.personId)) };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"

  // RLS already limits the members to the user's units; the pills are the companies they belong to
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && unitById.has(c.unitId) && data.members.some((m) => m.companyId === c.unitId))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  if (!companies.length) return <p className="tz-card m-0 p-5 text-ink-muted">אין לך חיילים בסבב הפעיל.</p>;
  const unit = companies.find((c) => c.id === sp.unit) ?? companies[0]!;

  const optionName = new Map(data.options.map((o) => [o.id, o.name]));
  const platoonOrder = (id: string | null) => (id ? (unitById.get(id)?.sortOrder ?? 0) + 1 : 0);
  const rows: SoldierVM[] = data.members
    .filter((m) => m.companyId === unit.id)
    .sort((a, b) => platoonOrder(a.platoonId) - platoonOrder(b.platoonId) || (a.platoonName ?? "").localeCompare(b.platoonName ?? "", "he"))
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      sub: [m.platoonName, m.roleTitle].filter(Boolean).join(" · "),
      inReport: m.inReport,
      callUpOn: m.callUpOn,
      releasedOn: m.releasedOn,
      arriving: m.arriving,
      arrivalName: m.arrivalOptionId ? (optionName.get(m.arrivalOptionId) ?? null) : null,
      editable: can(s.user, "doch1", ["admin", "company_user"], m.unitId, s.parents),
    }));

  const fillable = rows.filter((m) => m.editable && !m.callUpOn && data.reported.has(m.personId)).map((m) => m.personId);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="tz-footnote">
          {unit.name} · {data.round.name}
        </span>
        <h1 className="tz-large-title">חיילים</h1>
        <p className="tz-footnote m-0">
          חייל מופיע בדוח, בלוח, בסקירה ובשבצ״ק מתאריך הגיוס ועד תאריך השחרור (כולל). חייל בלי תאריך גיוס, או שצפי ההגעה שלו ״לא מגיע״, לא מופיע באף רשימה. לחיצה על חייל פותחת את הכרטיס שלו; תאריכים לכמה חיילים יחד: ״בחירה״.
        </p>
      </div>
      {companies.length > 1 ? (
        <nav className="tz-pills" aria-label="פלוגה">
          {companies.map((c) => (
            <Link key={c.id} href={`/doch1/soldiers?unit=${c.id}`} className="tz-pill" aria-current={c.id === unit.id ? "page" : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {fillable.length ? (
        <div className="tz-alert m-0 flex flex-wrap items-center justify-between gap-2">
          <span>
            {fillable.length === 1 ? "לחייל אחד" : <>ל־<span className="tz-num">{fillable.length}</span> חיילים</>} אין תאריך גיוס, אבל יש ימים בסד״כ בסבב. תאריך הגיוס יהיה היום הראשון בסד״כ (לא 0 ולא נפקד).
          </span>
          <ActionButton action={fillCallUpFromReports.bind(null, { personIds: fillable })} label="השלמת תאריך גיוס" variant="tinted" />
        </div>
      ) : null}
      <SoldiersBoard key={unit.id} rows={rows} today={israelToday(new Date())} initialFilter={sp.show ?? "all"} back={`/doch1/soldiers?unit=${unit.id}`} />
    </div>
  );
}
