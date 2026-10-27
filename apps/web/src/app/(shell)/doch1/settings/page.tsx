import { notFound } from "next/navigation";
import { byHe, dayRange, israelToday } from "@gdud/core";
import { desc, schema, withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { countMembersByCompany, loadMembers, loadRoundCompanies, loadStatuses, toRoundVM } from "@/lib/doch1/data";
import { loadLocations, loadStandbyTypes, loadTeams, loadVehicles } from "@/lib/doch1/standby";
import { fmtDay } from "@/lib/doch1/format";
import { DepartmentRoles } from "@/components/department-roles/department-roles";
import { requireModule } from "@/lib/session";
import { CompaniesTable, type CompanyRow } from "./_components/companies-table";
import { RoundForm } from "./_components/round-form";
import { LocationsEditor, StandbyTypesEditor, VehiclesEditor, type LocationRow, type StandbyTypeRow, type VehicleSettingsRow } from "./_components/standby-settings";
import { StatusEditor } from "./_components/status-editor";

export const metadata = { title: "דוח 1 · הגדרות" };

const SECTIONS = [
  { id: "round", label: "גדוד וסבב", color: "var(--primary)" },
  { id: "companies", label: "פלוגות ומסגרות", color: "var(--tile-brigade)" },
  { id: "statuses", label: "סטטוסים", color: "var(--bar-broken)" },
  { id: "standby", label: "שבצ״ק, כוננות ורכבים", color: "var(--tile-broken)" },
  { id: "rounds", label: "סבבים", color: "var(--tile-neutral)" },
  { id: "roles", label: "הרשאות", color: "var(--tile-ok)" },
] as const;

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

/** "כך זה ייראה": the app tile and how far the round is (mockup 05). */
function RoundPreview({ battalion, round }: { battalion: string; round: { name: string; startsOn: string; endsOn: string } }) {
  const length = dayRange(round.startsOn, round.endsOn).length;
  const today = israelToday(new Date());
  const day = Math.min(length, Math.max(0, dayRange(round.startsOn, today).length));
  return (
    <div className="tz-card flex flex-[1_1_240px] flex-col items-center gap-2.5 p-[22px] text-center">
      <span className="tz-footnote">כך זה ייראה</span>
      <span className="grid size-[72px] place-items-center rounded-[18px] bg-primary text-2xl font-bold text-white shadow-[var(--app-icon)]">ד1</span>
      <span className="tz-headline">דוח 1 · {battalion}</span>
      <span className="tz-footnote">
        {round.name} · {dm(round.startsOn)}–{dm(round.endsOn)} · <span className="tz-num">{length}</span> ימים
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-fill">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${length ? (day / length) * 100 : 0}%` }} />
      </span>
      <span className="tz-footnote">{day ? `יום ${day} מתוך ${length}` : "הסבב עוד לא התחיל"}</span>
    </div>
  );
}

export default async function Doch1Settings() {
  const s = await requireModule("doch1");
  if (!doch1Access(s).isMaster) notFound();

  const data = await withUser(s.claims, async (tx) => {
    const rounds = await tx.select().from(schema.doch1Rounds).orderBy(desc(schema.doch1Rounds.startsOn));
    const active = rounds.find((r) => r.active) ?? null;
    if (!active) return { rounds, active, companies: [], statuses: [], replaced: 0, counts: new Map<string, number>(), standby: null };
    const [companies, all, counts, locations, types, vehicles, teams, members] = await Promise.all([
      loadRoundCompanies(tx, active.id),
      loadStatuses(tx, active.id, { includeInactive: true }),
      countMembersByCompany(tx, active.id, s.units),
      loadLocations(tx, active.id),
      loadStandbyTypes(tx, active.id),
      loadVehicles(tx),
      loadTeams(tx, active.id),
      loadMembers(tx, active.id, s.units),
    ]);
    const current = all.filter((x) => x.active);
    return { rounds, active, companies, statuses: current, replaced: all.length - current.length, counts, standby: { locations, types, vehicles, teams, members } };
  });

  const active = data.active ? toRoundVM(data.active) : null;
  const companyRows: CompanyRow[] = s.units
    .filter((u) => u.kind === "company" && u.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name))
    .map((u) => {
      const rc = data.companies.find((c) => c.unitId === u.id);
      return {
        unitId: u.id,
        name: u.name,
        color: u.color,
        inRound: !!rc,
        active: rc?.active ?? false,
        appFrom: rc?.appFrom ?? null,
        members: data.counts.get(u.id) ?? 0,
      };
    });
  const others = data.rounds.filter((r) => !r.active).map(toRoundVM);
  const unitName = new Map(s.units.map((u) => [u.id, u.name]));
  const names = (ids: Iterable<string>) => [...new Set(ids)].map((id) => unitName.get(id) ?? "").filter(Boolean).join(", ");
  const sb = data.standby;
  const locationRows: LocationRow[] = (sb?.locations ?? []).map((l) => ({ ...l, count: sb!.members.filter((m) => m.locationId === l.id).length }));
  const typeRows: StandbyTypeRow[] = (sb?.types ?? []).map((t) => ({ ...t, heldBy: names(sb!.teams.filter((x) => x.typeId === t.id).flatMap((x) => x.holderIds)) }));
  const vehicleRows: VehicleSettingsRow[] = (sb?.vehicles ?? []).map((v) => ({
    ...v,
    teams: sb!.teams
      .filter((t) => t.vehicleId === v.id)
      .map((t) => `${t.name}${t.holderIds.length ? ` · ${names(t.holderIds)}` : ""}`)
      .join(", "),
  }));
  const battalion = s.units.find((u) => u.kind === "battalion")?.name ?? "גדוד";
  const sections = SECTIONS.filter((x) => active || x.id === "round" || x.id === "rounds" || x.id === "roles");

  return (
    <div className="flex flex-col gap-[22px] lg:flex-row lg:items-start lg:gap-8">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:w-[220px] lg:flex-none">
        <h1 className="tz-large-title">הגדרות</h1>
        <nav aria-label="אזורי הגדרות" className="tz-pills lg:flex-col lg:gap-0.5 lg:overflow-visible">
          {sections.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="tz-pill lg:h-10 lg:rounded-[9px] lg:bg-transparent lg:px-2.5 lg:text-[15px] lg:hover:bg-fill">
              <span aria-hidden="true" className="size-[22px] flex-none rounded-[6px]" style={{ background: x.color }} />
              {x.label}
            </a>
          ))}
        </nav>
        <p className="tz-footnote m-0 px-1">שינוי בהגדרות חל מהיום והלאה. ימים שכבר דווחו נשארים כמו שהם.</p>
      </aside>

      <div className="flex min-w-0 max-w-[1080px] flex-1 flex-col gap-[30px]">
        <section id="round" className="flex scroll-mt-6 flex-col gap-1.5">
          <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">{active ? `גדוד וסבב · ${active.name}` : "סבב חדש"}</h2>
          <div className="flex flex-wrap items-start gap-[18px]">
            <div className="min-w-0 flex-[2_1_420px]">
              <RoundForm round={active ? { ...active, active: true } : null} />
            </div>
            {active ? <RoundPreview battalion={battalion} round={active} /> : null}
          </div>
        </section>

        {active ? (
          <>
            <section id="companies" className="flex scroll-mt-6 flex-col gap-1.5">
              <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">פלוגות ומסגרות</h2>
              <CompaniesTable roundId={active.id} rows={companyRows} />
              <p className="tz-section-footer">
                פלוגה לא פעילה לא נספרת בסבב. ״דיווח באפליקציה מתאריך״ מפעיל את הפיילוט: מהתאריך הזה הייבוא מהגיליון לא משנה את ימי הפלוגה.
              </p>
            </section>

            <section id="statuses" className="flex scroll-mt-6 flex-col gap-1.5">
              <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">סטטוסים</h2>
              <StatusEditor roundId={active.id} statuses={data.statuses} />
              <p className="tz-section-footer">
                כל הספירות מחושבות לפי הדגלים, לא לפי השם. שינוי דגלים בסטטוס שכבר דווח יוצר גרסה חדשה מהיום והלאה
                {data.replaced ? ` (${data.replaced} גרסאות קודמות שמורות)` : ""}. ״זמין לכוננות״ קובע מי נספר כזמין בצוותי הכוננות היום.
              </p>
            </section>

            <section id="standby" className="flex scroll-mt-6 flex-col gap-1.5">
              <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">שבצ״ק, כוננות ורכבים</h2>
              <h3 className="tz-section-header">מיקומים בשבצ״ק</h3>
              <LocationsEditor roundId={active.id} rows={locationRows} />
              <p className="tz-section-footer">חייל בסטטוס ״דורש מוצב״ בלי מיקום מסוג מוצב, או במוצב בסטטוס אחר, מופיע ב״לטיפול בשבצ״ק״.</p>
              <h3 className="tz-section-header pt-3.5">סוגי כוננות</h3>
              <StandbyTypesEditor roundId={active.id} rows={typeRows} />
              <p className="tz-section-footer">צוות שחסר בו תפקיד חובה או שאין בו מספיק זמינים מסומן כחסר כוח. את הצוותים עצמם יוצרים ועורכים בשבצ״ק וכוננות.</p>
              <h3 className="tz-section-header pt-3.5">מאגר רכבים</h3>
              <VehiclesEditor rows={vehicleRows} />
              <p className="tz-section-footer">המאגר משותף לכל הסבבים. רכב שאינו תקין מסמן את הצוות שלו כלא כשיר.</p>
            </section>
          </>
        ) : null}

        {others.length || active ? (
          <section id="rounds" className="flex scroll-mt-6 flex-col gap-1.5">
            <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">סבבים</h2>
            <div className="tz-group">
              {others.map((r) => (
                <details key={r.id} className="border-b border-separator">
                  <summary className="cursor-pointer px-4 py-3">
                    {r.name} · <span className="tz-num">{fmtDay(r.startsOn)}–{fmtDay(r.endsOn)}</span>
                  </summary>
                  <div className="px-4 pb-4">
                    <RoundForm round={{ ...r, active: false }} />
                  </div>
                </details>
              ))}
              {active ? (
                <details>
                  <summary className="cursor-pointer px-4 py-3 font-semibold text-primary">סבב חדש</summary>
                  <div className="px-4 pb-4">
                    <RoundForm round={null} />
                  </div>
                </details>
              ) : null}
            </div>
          </section>
        ) : null}

        <section id="roles" className="flex scroll-mt-6 flex-col gap-1.5">
          <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">הרשאות</h2>
          <DepartmentRoles s={s} module="doch1" />
        </section>
      </div>
    </div>
  );
}
