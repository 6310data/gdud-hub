import Link from "next/link";
import { can } from "@gdud/auth";
import { callUpBrigadeText, callUpSummary, inCallUp, isDay, israelToday, type CallUpCounts, type CallUpMember, type EnlistmentEffect } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadFieldOptions, loadMembers, loadRoundCompanies } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { DayNav } from "../_components/day-nav";
import { CallUpList, type CallUpRow } from "./_components/call-up-list";
import { CallUpText } from "./_components/call-up-text";

export const metadata = { title: "דוח 1 · יום גיוס" };

/** A company's (or the battalion's) row of the call-up table. */
function Row({ name, c, href }: { name: string; c: CallUpCounts; href?: string }) {
  return (
    <>
      <th scope="row" className="font-semibold">
        {href ? (
          <Link href={href} className="tz-cell-link">
            {name}
          </Link>
        ) : (
          name
        )}
      </th>
      <td className="tz-num">{c.expected}</td>
      <td className="tz-num font-semibold">{c.arrived}</td>
      <td className={`tz-num ${c.pending ? "" : "tz-zero"}`}>{c.pending}</td>
      <td className={`tz-num ${c.postponed ? "" : "tz-zero"}`}>{c.postponed}</td>
      <td className={`tz-num ${c.released ? "" : "tz-zero"}`}>{c.released}</td>
      <td className="tz-num">{c.percent === null ? "—" : `${c.percent}%`}</td>
    </>
  );
}

/**
 * יום גיוס (spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md, "Call-up day screen"):
 * who showed up, per company and battalion (replaces the sheet's דוחות יום גיוס), the brigade text,
 * and for the admin and company users each soldier's סטטוס גיוס. Opens on the round's call-up day
 * until it has passed, then on today; `?day=` picks another day.
 */
export default async function Doch1CallUp({ searchParams }: { searchParams: Promise<{ day?: string; unit?: string }> }) {
  const s = await requireModule("doch1");
  const access = doch1Access(s);
  const sp = await searchParams;
  const today = israelToday(new Date());

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const [companies, members, options] = await Promise.all([loadRoundCompanies(tx, round.id), loadMembers(tx, round.id, s.units), loadFieldOptions(tx, round.id)]);
    return { round, companies, members, options: options.filter((o) => o.field === "enlistment") };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"
  const { round } = data;
  const inRound = (d: string) => d >= round.startsOn && d <= round.endsOn;
  const fallback = round.callUpOn && today < round.callUpOn ? round.callUpOn : today;
  const day = sp.day && isDay(sp.day) && inRound(sp.day) ? sp.day : inRound(fallback) ? fallback : round.startsOn;

  const effectOf = new Map(data.options.map((o) => [o.id, o.effect as EnlistmentEffect]));
  const callUp: CallUpMember[] = data.members.map((m) => ({
    personId: m.personId,
    companyId: m.companyId,
    callUpOn: m.callUpOn,
    releasedOn: m.releasedOn,
    arriving: m.arriving,
    enlistment: m.enlistmentOptionId ? (effectOf.get(m.enlistmentOptionId) ?? null) : null,
    enlistmentOptionId: m.enlistmentOptionId,
  }));
  const summary = callUpSummary(callUp, day);
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && summary.byCompany.has(c.unitId) && unitById.has(c.unitId))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const battalion = s.units.find((u) => u.kind === "battalion")?.name ?? "גדוד";
  const text = callUpBrigadeText({
    battalionName: battalion,
    day,
    total: summary.total,
    companies: companies.map((c) => ({ name: c.name, summary: summary.byCompany.get(c.id)! })),
  });

  const canMark = access.isAdmin || can(s.user, "doch1", ["company_user"]);
  const unit = companies.find((c) => c.id === sp.unit) ?? companies[0];
  const inCall = new Set(callUp.filter((m) => inCallUp(m, day)).map((m) => m.personId));
  const rows: CallUpRow[] = data.members
    .filter((m) => m.companyId === unit?.id && inCall.has(m.personId))
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      sub: [m.platoonName, m.roleTitle].filter(Boolean).join(" · "),
      enlistmentOptionId: m.enlistmentOptionId,
      callUpOn: m.callUpOn,
      releasedOn: m.releasedOn,
      editable: can(s.user, "doch1", ["admin", "company_user"], m.unitId, s.parents),
    }));

  const dayQuery = sp.day ? `&day=${day}` : "";

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <span className="tz-footnote">{round.name}</span>
        <h1 className="tz-large-title">יום גיוס</h1>
        <DayNav day={day} today={today} min={round.startsOn} max={round.endsOn} path="/doch1/call-up" params={{ unit: sp.unit ?? null }} />
        <p className="tz-footnote m-0">
          מי שגויס עד היום הזה ומגיע לסבב. ״נדחה״ ו״שוחרר״ לא נספרים בצפויים; התייצבו מתוך הצפויים. חייל בלי סטטוס גיוס נספר כטרם התייצב.
        </p>
      </div>

      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th>פלוגה</th>
              <th>צפויים</th>
              <th>התייצבו</th>
              <th>טרם התייצבו</th>
              <th>נדחו</th>
              <th>שוחררו</th>
              <th>אחוז התייצבות</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="tz-hover">
                <Row name={c.name} c={summary.byCompany.get(c.id)!} href={canMark ? `/doch1/call-up?unit=${c.id}${dayQuery}` : undefined} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Row name="סה״כ" c={summary.total} />
            </tr>
          </tfoot>
        </table>
      </div>

      {access.isAdmin ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="tz-section-header">לחטיבה</h2>
          <CallUpText text={text} />
        </section>
      ) : null}

      {canMark && unit ? (
        <section className="flex flex-col gap-2">
          {companies.length > 1 ? (
            <nav className="tz-pills" aria-label="פלוגה">
              {companies.map((c) => (
                <Link key={c.id} href={`/doch1/call-up?unit=${c.id}${dayQuery}`} className="tz-pill" aria-current={c.id === unit.id ? "page" : undefined}>
                  {c.name}
                  <span className="tz-pill-count tz-num">{summary.byCompany.get(c.id)?.pending ?? 0}</span>
                </Link>
              ))}
            </nav>
          ) : (
            <h2 className="tz-headline">{unit.name}</h2>
          )}
          <CallUpList key={`${unit.id}|${day}`} rows={rows} options={data.options} day={day} />
        </section>
      ) : null}
    </div>
  );
}
