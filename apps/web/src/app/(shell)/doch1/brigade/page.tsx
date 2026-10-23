import { notFound } from "next/navigation";
import { hebrewDayLabel, isDay, israelToday, missingMembers, summarize, type BrigadeInput } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { requireModule } from "@/lib/session";
import { BrigadePreview } from "./_components/brigade-preview";

export const metadata = { title: "דוח 1 · לחטיבה" };

export default async function Doch1Brigade({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isAdmin) notFound();
  const sp = await searchParams;
  const day = sp.day && isDay(sp.day) ? sp.day : israelToday(new Date());

  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const [companies, members, statuses, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, [day]),
    ]);
    return { companies, members, statuses, day: days.get(day)! };
  });
  if (!data) return null; // the layout shows "אין סבב פעיל"

  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies = data.companies
    .filter((c) => c.active && unitById.has(c.unitId))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  const battalion = s.units.find((u) => u.kind === "battalion");
  const input: BrigadeInput = {
    battalionName: battalion?.name ?? "גדוד",
    day,
    total: summarize(data.members, data.day, data.statuses),
    companies: companies.map((c) => ({
      name: c.name,
      summary: summarize(
        data.members.filter((m) => m.companyId === c.id),
        data.day,
        data.statuses,
      ),
    })),
    missingNames: companies.flatMap((c) =>
      missingMembers(
        data.members.filter((m) => m.companyId === c.id),
        data.day,
      ).map((m) => ({ company: c.name, name: m.name })),
    ),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto flex w-full max-w-[640px] flex-col">
        <span className="tz-footnote">{hebrewDayLabel(day)}</span>
        <h1 className="tz-title">דוח לחטיבה</h1>
      </div>
      <BrigadePreview input={input} />
    </div>
  );
}
