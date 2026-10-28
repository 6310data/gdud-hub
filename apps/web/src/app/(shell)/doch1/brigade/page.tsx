import { notFound } from "next/navigation";
import { hebrewDayLabel, isDay, israelToday, missingMembers, summarize, type BrigadeInput } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { requireModule } from "@/lib/session";
import { DayNav } from "../_components/day-nav";
import { BrigadePreview } from "./_components/brigade-preview";

export const metadata = { title: "דוח 1 · לחטיבה" };

export default async function Doch1Brigade({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isAdmin) notFound();
  const sp = await searchParams;
  const today = israelToday(new Date());

  const { active: round } = await doch1Rounds(s);
  if (!round) return null; // the layout shows "אין סבב פעיל"
  const data = await withUser(s.claims, async (tx) => {
    const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
    const [companies, members, statuses, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, [day]),
    ]);
    return { round, day, companies, members: listedOn(members, day), statuses, dayStatuses: days.get(day)! };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"
  const { day } = data;

  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && unitById.has(c.unitId))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const battalion = s.units.find((u) => u.kind === "battalion");
  const input: BrigadeInput = {
    battalionName: battalion?.name ?? "גדוד",
    day,
    total: summarize(data.members, data.dayStatuses, data.statuses),
    companies: companies.map((c) => ({
      name: c.name,
      summary: summarize(
        data.members.filter((m) => m.companyId === c.id),
        data.dayStatuses,
        data.statuses,
      ),
    })),
    missingNames: companies.flatMap((c) =>
      missingMembers(
        data.members.filter((m) => m.companyId === c.id),
        data.dayStatuses,
      ).map((m) => ({ company: c.name, name: m.name })),
    ),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto flex w-full max-w-[640px] flex-col">
        <span className="tz-footnote">{hebrewDayLabel(day)}</span>
        <h1 className="tz-title">דוח לחטיבה</h1>
        <DayNav day={day} today={today} min={data.round.startsOn} max={data.round.endsOn} path="/doch1/brigade" />
      </div>
      <BrigadePreview key={day} input={input} />
    </div>
  );
}
