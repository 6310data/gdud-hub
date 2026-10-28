import { notFound } from "next/navigation";
import { scopesFor } from "@gdud/auth";
import { hebrewDayLabel, isDay, israelToday, missingMembers, sheetColumnLines, sheetRowAnchors } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access } from "@/lib/doch1/access";
import { listedOn, loadDays, loadMembers, loadRoundCompanies, loadStatuses } from "@/lib/doch1/data";
import { doch1Rounds } from "@/lib/doch1/rounds";
import { requireModule } from "@/lib/session";
import { DayNav } from "../_components/day-nav";
import { Panel } from "../_components/panel";
import { CopyColumn } from "./_components/copy-column";

export const metadata = { title: "דוח 1 · העתקה לגיליון" };

/** The most common sheet tab among the company's members = the company's tab in the sheet. */
function companyTab(tabs: ReadonlyArray<string | null>): string | null {
  const count = new Map<string, number>();
  for (const t of tabs) if (t) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Copy a company's day back into the sheet: the status sheet values in the tab's row order. */
export default async function Doch1Copy({ searchParams }: { searchParams: Promise<{ unit?: string; day?: string }> }) {
  const s = await requireModule("doch1");
  if (!doch1Access(s).canCopy) notFound();
  const sp = await searchParams;
  const today = israelToday(new Date());

  const { active: round } = await doch1Rounds(s);
  if (!round) return null; // the layout shows "אין סבב פעיל"
  const day = sp.day && isDay(sp.day) && sp.day >= round.startsOn && sp.day <= round.endsOn ? sp.day : today;
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const own = scopesFor(s.user, "doch1", ["company_user"]);

  // one transaction, one batch
  const data = await withUser(s.claims, async (tx) => {
    const [roundCompanyRows, members, statuses, days] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, [day]),
    ]);
    const roundCompanies = roundCompanyRows.filter((c) => c.active).map((c) => c.unitId);
    const access = doch1Access(s, roundCompanies);
    const companies = (access.isAdmin || own.includes(null) ? roundCompanies : own.filter((u): u is string => !!u && roundCompanies.includes(u)))
      .filter((id) => unitById.get(id)?.kind === "company")
      .sort((a, b) => unitById.get(a)!.sortOrder - unitById.get(b)!.sortOrder);
    if (!companies.length) return null;
    const unitId = sp.unit && companies.includes(sp.unit) ? sp.unit : companies[0]!;
    return { companies, unitId, members: members.filter((m) => m.companyId === unitId), statuses, day: days.get(day)! };
  });
  if (!data) return <p className="tz-card m-0 p-5 text-ink-muted">אין לך פלוגה פעילה בסבב.</p>;
  const { companies, unitId } = data;

  const sheetValue = new Map(data.statuses.map((st) => [st.id, st.sheetValue]));
  const tab = companyTab(data.members.map((m) => m.sheetTab));
  const inSheet = (m: (typeof data.members)[number]) => tab !== null && m.sheetTab === tab && m.sheetRow !== null;
  const { lines, firstRow } = sheetColumnLines(
    data.members.map((m) => ({ sheetRow: inSheet(m) ? m.sheetRow : null, value: sheetValue.get(data.day.get(m.personId) ?? "") ?? "" })),
  );
  // a soldier not listed that day (before call-up / after release / not arriving) keeps their sheet row and value, but isn't missing
  const listed = listedOn(data.members, day);
  const notInSheet = listed.filter((m) => !inSheet(m));
  const anchors = sheetRowAnchors(data.members.map((m) => ({ sheetRow: inSheet(m) ? m.sheetRow : null, name: m.name })));
  const missing = missingMembers(listed, data.day).length;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-[22px]">
      <div className="flex flex-col">
        <span className="tz-footnote">
          {unitById.get(unitId)!.name} · {hebrewDayLabel(day)}
        </span>
        <h1 className="tz-title">העתקה לגיליון</h1>
        <DayNav day={day} today={today} min={round.startsOn} max={round.endsOn} path="/doch1/copy" params={{ unit: unitId }} />
      </div>

      <form className="tz-card flex flex-wrap items-end gap-3 p-4" action="/doch1/copy">
        <label className="tz-field">
          <span className="tz-label">פלוגה</span>
          <select name="unit" defaultValue={unitId} className="tz-input w-auto">
            {companies.map((id) => (
              <option key={id} value={id}>
                {unitById.get(id)!.name}
              </option>
            ))}
          </select>
        </label>
        {day !== today ? <input type="hidden" name="day" value={day} /> : null}
        <button className="tz-btn tz-btn-tinted tz-btn-sm">הצגה</button>
      </form>

      {missing ? (
        <p className="tz-alert m-0" style={{ background: "var(--status-broken-soft)", color: "var(--status-broken)" }}>
          {missing} חסרים — יודבקו כתאים ריקים
        </p>
      ) : null}

      {anchors.length ? (
        <Panel
          title="לפני ההדבקה: לוודא שהשורות בגיליון תואמות"
          footer="השורות נלקחות מהייבוא האחרון של הגיליון. אם נוספו או נמחקו שורות בגיליון מאז, השמות כאן לא יתאימו — בקשו ייבוא מחדש לפני ההדבקה."
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {anchors.map((a) => (
              <li key={a.row} className="flex justify-between gap-3 border-b border-separator px-4 py-2 text-[14px] last:border-b-0">
                <span className="tz-num text-ink-muted">שורה {a.row}</span>
                <span>{a.name}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title={firstRow !== null && tab ? `שורות ${firstRow}–${firstRow + lines.length - 1} בלשונית ${tab}` : "אין חיילים עם שורה בגיליון"}
        footer="הדביקו בעמודת היום, בשורה הראשונה שמופיעה כאן. כל שורה כאן היא שורה בגיליון, גם ריקה."
      >
        <div className="p-4">{lines.length ? <CopyColumn text={lines.join("\n")} label="עמודת היום להעתקה" /> : <p className="m-0 text-ink-muted">אין מה להעתיק.</p>}</div>
      </Panel>

      {notInSheet.length ? (
        <Panel title={`לא בגיליון (${notInSheet.length}) — להוסיף ידנית`}>
          <ul className="m-0 flex list-none flex-col p-0">
            {notInSheet.map((m) => (
              <li key={m.personId} className="flex justify-between gap-3 border-b border-separator px-4 py-2 text-[14px] last:border-b-0">
                <span>
                  {m.name}
                  {m.platoonName ? <span className="tz-footnote"> · {m.platoonName}</span> : null}
                </span>
                <span>{data.statuses.find((st) => st.id === data.day.get(m.personId))?.sheetValue ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
