import Link from "next/link";
import { notFound } from "next/navigation";
import { scopesFor } from "@gdud/auth";
import { addDays, dayRange, isDay, isDayWritable, israelToday, type Day } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { requireModule } from "@/lib/session";
import { BoardGrid, type BoardMember, type DaysByDay } from "./_components/board-grid";

export const metadata = { title: "דוח 1 · לוח נוכחות" };

/** Days on the board and how many of them come before today (mockup 02: a week back, a week ahead). */
const WINDOW = 14;
const PAST = 6;

const later = (a: Day, b: Day) => (a > b ? a : b);
const earlier = (a: Day, b: Day) => (a < b ? a : b);

/** Attendance board (mockup screen 02): one company's soldiers × days; days after today are the plan. */
export default async function Doch1Board({ searchParams }: { searchParams: Promise<{ unit?: string; from?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).canBoard) notFound();
  const sp = await searchParams;

  const { active: round } = await doch1Rounds(s);
  if (!round) return null; // the layout shows "אין סבב פעיל"
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const own = scopesFor(s.user, "doch1", ["company_user"]);

  const now = new Date();
  const today = israelToday(now);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  // the window stays inside the round
  const lastFrom = later(round.startsOn, addDays(round.endsOn, -(WINDOW - 1)));
  const wanted = sp.from && isDay(sp.from) ? sp.from : addDays(today, -PAST);
  const from = earlier(later(wanted, round.startsOn), lastFrom);
  const shown = dayRange(from, earlier(addDays(from, WINDOW - 1), round.endsOn));
  const loadList = [...new Set([...shown, yesterday, today, tomorrow])];

  // one transaction: companies, members and statuses in one batch, then the chosen company's days
  const data = await withUser(s.claims, async (tx) => {
    const [roundCompanyRows, all, statuses] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
    ]);
    const roundCompanies = roundCompanyRows.filter((c) => c.active).map((c) => c.unitId);
    const access = doch1Access(s, roundCompanies);
    const companies = (access.isAdmin || own.includes(null) ? roundCompanies : own.filter((u): u is string => !!u && roundCompanies.includes(u)))
      .filter((id) => unitById.get(id)?.kind === "company")
      .sort((a, b) => unitById.get(a)!.sortOrder - unitById.get(b)!.sortOrder);
    if (!companies.length) return null;
    const unitId = sp.unit && companies.includes(sp.unit) ? sp.unit : companies[0]!;
    const members = all.filter((m) => m.companyId === unitId);
    const loaded = await loadDays(tx, round.id, loadList, { personIds: members.map((m) => m.personId) });
    return { access, companies, unitId, members, statuses, loaded };
  });
  if (!data) return <p className="tz-card m-0 p-5 text-ink-muted">אין לך פלוגה פעילה בסבב.</p>;
  const { access, companies, unitId } = data;
  const unit = unitById.get(unitId)!;

  const platoonOrder = (id: string | null) => (id ? (unitById.get(id)?.sortOrder ?? 0) + 1 : 0);
  const members: BoardMember[] = data.members
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      roleTitle: m.roleTitle,
      companyId: m.companyId,
      platoonId: m.platoonId,
      platoonName: m.platoonName,
      inReport: m.inReport,
      callUpOn: m.callUpOn,
      releasedOn: m.releasedOn,
      arriving: m.arriving,
    }))
    .sort((a, b) => platoonOrder(a.platoonId) - platoonOrder(b.platoonId) || (a.platoonName ?? "").localeCompare(b.platoonName ?? "", "he"));
  const days: DaysByDay = Object.fromEntries([...data.loaded].map(([d, m]) => [d, Object.fromEntries(m)]));

  const canEdit = access.canReport(unitId);
  const todayOpen = isDayWritable({ day: today, now, lockAt: round.lockAt, isAdmin: access.isAdmin });
  // the group update starts at the first day this user may still write
  const bulkFrom = later(todayOpen ? today : tomorrow, round.startsOn);

  const href = (f: Day | null) => `/doch1/board?unit=${unitId}${f ? `&from=${f}` : ""}`;
  const prev = from > round.startsOn ? href(later(addDays(from, -7), round.startsOn)) : null;
  const next = shown[shown.length - 1]! < round.endsOn ? href(earlier(addDays(from, 7), lastFrom)) : null;
  const showsToday = shown.includes(today);

  return (
    <>
      {companies.length > 1 ? (
        <nav className="tz-pills pb-0.5" aria-label="פלוגה">
          {companies.map((id) => (
            <Link key={id} href={`/doch1/board?unit=${id}${sp.from ? `&from=${from}` : ""}`} className="tz-pill" aria-current={id === unitId ? "page" : undefined}>
              {unitById.get(id)!.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <BoardGrid
        key={`${unitId}|${from}`}
        unitId={unitId}
        unitName={unit.name}
        shown={shown}
        today={today}
        yesterday={yesterday}
        tomorrow={tomorrow}
        roundStart={round.startsOn}
        roundEnd={round.endsOn}
        lockAt={round.lockAt}
        isAdmin={access.isAdmin}
        canEdit={canEdit}
        todayOpen={todayOpen}
        bulkFrom={canEdit && bulkFrom <= round.endsOn ? bulkFrom : null}
        members={members}
        statuses={data.statuses}
        days={days}
        nav={{ prev, next, today: showsToday || today < round.startsOn || today > round.endsOn ? null : href(null) }}
      />
    </>
  );
}
