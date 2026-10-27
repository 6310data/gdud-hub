import Link from "next/link";
import { can } from "@gdud/auth";
import { planningProgress, type ArrivalEffect } from "@gdud/core";
import { withUser } from "@gdud/db";
import { ActionButton } from "@/components/action-button";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadFieldOptions, loadPlanningRound } from "@/lib/doch1/data";
import { fmtDay } from "@/lib/doch1/format";
import { loadPlanningMembers } from "@/lib/doch1/planning";
import { requireModule } from "@/lib/session";
import { copyLastRound } from "../_actions/planning";
import { ReminderButton } from "../_components/reminder-button";
import { ActivateRound } from "./_components/activate-round";
import { ArrivalList, type ArrivalRow } from "./_components/arrival-list";

export const metadata = { title: "דוח 1 · תכנון סבב" };

/**
 * תכנון סבב (spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md, "Planning screen"):
 * the admin's steps — the battalion's list, צפי הגעה per company, activation — and, for the admin
 * and company users, צפי הגעה of each soldier in the round being planned.
 */
export default async function Doch1Planning({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const s = await requireModule("doch1");
  const access = doch1Access(s);
  const sp = await searchParams;
  const canPlan = access.isAdmin || can(s.user, "doch1", ["company_user"]);

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadPlanningRound(tx);
    if (!round || !canPlan) return { round, active: null, members: [], options: [] };
    const [active, members, options] = await Promise.all([
      loadActiveRound(tx),
      loadPlanningMembers(tx, round.id, s.units),
      loadFieldOptions(tx, round.id),
    ]);
    return { round, active, members, options: options.filter((o) => o.field === "arrival") };
  });

  const round = data.round;
  if (!round) {
    return (
      <div className="tz-card flex max-w-[640px] flex-col items-start gap-2 p-5">
        <h1 className="tz-headline">אין סבב בתכנון</h1>
        <p className="tz-footnote m-0">
          {access.isMaster ? "כדי להכין את הסבב הבא, יוצרים אותו בהגדרות › סבבים › סבב חדש." : "מנהל ראשי עוד לא פתח את הסבב הבא."}
        </p>
        {access.isMaster ? (
          <Link href="/doch1/settings#rounds" className="tz-btn tz-btn-tinted tz-btn-sm">
            להגדרות
          </Link>
        ) : null}
      </div>
    );
  }
  if (!canPlan) return <p className="tz-card m-0 p-5 text-ink-muted">תכנון הסבב הוא של מנהל גדודי ומשתמשי הפלוגות.</p>;

  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const effectOf = new Map(data.options.map((o) => [o.id, o.effect as ArrivalEffect]));
  const companies = [...new Set(data.members.map((m) => m.companyId).filter((id): id is string => !!id))]
    .map((id) => unitById.get(id)!)
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const progress = planningProgress(
    data.members.filter((m) => m.companyId).map((m) => ({ companyId: m.companyId!, arrival: m.arrivalOptionId ? (effectOf.get(m.arrivalOptionId) ?? null) : null })),
  );
  const unit = companies.find((c) => c.id === sp.unit) ?? companies[0];
  const platoonOrder = (id: string | null) => (id ? (unitById.get(id)?.sortOrder ?? 0) + 1 : 0);
  const rows: ArrivalRow[] = data.members
    .filter((m) => m.companyId === unit?.id)
    .sort((a, b) => platoonOrder(a.platoonId) - platoonOrder(b.platoonId) || (a.platoonName ?? "").localeCompare(b.platoonName ?? "", "he"))
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      sub: [m.platoonName, m.roleTitle].filter(Boolean).join(" · "),
      platoonName: m.platoonName,
      movedFrom: m.movedFrom,
      arrivalOptionId: m.arrivalOptionId,
      callUpOn: m.callUpOn,
      editable: can(s.user, "doch1", ["admin", "company_user"], m.unitId, s.parents),
    }));
  const total = progress.get("all")!;
  const moves = data.members.filter((m) => m.pendingMove).length;

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <span className="tz-footnote">
          {round.name} · <span className="tz-num">{fmtDay(round.startsOn)}–{fmtDay(round.endsOn)}</span>
          {round.callUpOn ? <> · גיוס <span className="tz-num">{fmtDay(round.callUpOn)}</span></> : null}
        </span>
        <h1 className="tz-large-title">תכנון סבב</h1>
        <p className="tz-footnote m-0">מי מגיע לסבב הבא. חייל שמסומן ״לא מגיע״ לא יופיע באף יום של הסבב, באף ספירה ובאף תזכורת.</p>
      </div>

      {access.isAdmin ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="tz-section-header">1 · רשימת הגדוד</h2>
          <div className="tz-group flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="flex-1 text-[15px]">
              {data.members.length ? (
                <>
                  <span className="tz-num">{data.members.length}</span> חיילים בסבב
                </>
              ) : (
                "עוד אין חיילים בסבב."
              )}
            </span>
            <Link href="/doch1/planning/roster" className="tz-btn tz-btn-tinted tz-btn-sm">
              {data.members.length ? "השוואה לרשימת הגדוד" : "העלאת רשימת הגדוד"}
            </Link>
            {!data.members.length ? <ActionButton action={copyLastRound} label="העתקה מהסבב הקודם" confirmLabel="להעתיק את כל החיילים?" /> : null}
          </div>

          <h2 className="tz-section-header pt-3">2 · צפי הגעה</h2>
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>פלוגה</th>
                  <th>חיילים</th>
                  <th>מגיעים</th>
                  <th>לא מגיעים</th>
                  <th>לא מולא</th>
                  <th aria-label="תזכורת" />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const p = progress.get(c.id)!;
                  return (
                    <tr key={c.id} className="tz-hover">
                      <th scope="row" className="font-semibold">
                        <Link href={`/doch1/planning?unit=${c.id}`} className="tz-cell-link">
                          {c.name}
                        </Link>
                      </th>
                      <td className="tz-num">{p.total}</td>
                      <td className="tz-num">{p.arriving}</td>
                      <td className="tz-num">{p.notArriving}</td>
                      <td className={`tz-num ${p.blank ? "font-semibold text-danger" : "tz-zero"}`}>{p.blank}</td>
                      <td>{p.blank ? <ReminderButton unitId={c.id} name={c.name} kind="arrival" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">סה״כ</th>
                  <td className="tz-num">{total.total}</td>
                  <td className="tz-num">{total.arriving}</td>
                  <td className="tz-num">{total.notArriving}</td>
                  <td className="tz-num">{total.blank}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <h2 className="tz-section-header pt-3">3 · הפעלת הסבב</h2>
          <div className="tz-group flex flex-col gap-2 px-4 py-3 text-[15px]">
            <span>{data.active ? `ההפעלה סוגרת את ${data.active.name} ופותחת את ${round.name}.` : `אין סבב פעיל. ההפעלה פותחת את ${round.name}.`}</span>
            {access.isMaster ? (
              <ActivateRound
                lines={[
                  data.active ? `${data.active.name} נסגר: מסך היום, הלוח והתזכורות עוברים ל${round.name}.` : `${round.name} נפתח.`,
                  `${round.name} נפתח עם ${data.members.length} חיילים; מי שמסומן ״לא מגיע״ לא יופיע באף יום.`,
                  ...(moves ? [`${moves} חיילים עוברים פלוגה.`] : []),
                ]}
                warning={total.blank ? `ל־${total.blank} חיילים עוד אין צפי הגעה. הם ייחשבו מגיעים.` : null}
              />
            ) : (
              <span className="tz-footnote">מנהל ראשי מפעיל את הסבב.</span>
            )}
          </div>
        </section>
      ) : null}

      {unit ? (
        <section className="flex flex-col gap-2">
          {companies.length > 1 ? (
            <nav className="tz-pills" aria-label="פלוגה">
              {companies.map((c) => (
                <Link key={c.id} href={`/doch1/planning?unit=${c.id}`} className="tz-pill" aria-current={c.id === unit.id ? "page" : undefined}>
                  {c.name}
                  <span className="tz-pill-count tz-num">{progress.get(c.id)?.blank ?? 0}</span>
                </Link>
              ))}
            </nav>
          ) : (
            <h2 className="tz-headline">{unit.name}</h2>
          )}
          <ArrivalList key={unit.id} rows={rows} options={data.options} round={{ startsOn: round.startsOn, endsOn: round.endsOn }} />
        </section>
      ) : (
        <p className="tz-card m-0 p-5 text-ink-muted">{access.isAdmin ? "עוד אין חיילים בסבב." : "אין לך חיילים בסבב הזה."}</p>
      )}
    </div>
  );
}
