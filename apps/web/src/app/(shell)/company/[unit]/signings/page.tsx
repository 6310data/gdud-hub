import Link from "next/link";
import { z } from "zod";
import { byHe, lineage } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Serial } from "@gdud/ui";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader, Panel, withParams } from "@/components/page-parts";
import { SegLinks } from "@/app/(shell)/kesher/_components/ui";
import { requireCompanyScope } from "@/lib/company/access";
import { loadRegister, loadRegisterItems, loadSoldierNames, type SigningRow } from "@/lib/company/data";
import { fmtCount, fmtDateTime, fmtWhen } from "@/lib/logistics/format";
import { returnInternal } from "../../_actions/register";
import type { PickPerson } from "@/components/person-picker";
import { GEAR_DEPT_LABEL, SignForm, type GearOption } from "../../_components/sign-form";
import { CompanyPills } from "../../_components/ui";

export const metadata = { title: "החתמות פנימיות" };

const paramsSchema = z.object({ unit: z.uuid() });
const searchSchema = z.object({
  tab: z.enum(["open", "history", "new"]).catch("open"),
  platoon: z.uuid().optional().catch(undefined),
});

/**
 * החתמות (החתמה פנימית): the company's own register of who has a piece of gear now — kesher צ׳ on
 * the company and the company's items. Open entries (a platoon commander's platoon first) with
 * הוחזר, the history, and חדש. Nothing here changes kesher or logistics.
 */
export default async function SigningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ unit: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = paramsSchema.safeParse(await params);
  const { s, access, scope } = await requireCompanyScope(p.success ? p.data.unit : "");
  const f = searchSchema.parse(await searchParams);
  const company = scope.company;
  const now = new Date();

  const { rows, items, soldiers } = await withUser(s.claims, async (tx) => {
    const [rows, items, soldiers] = await Promise.all([
      f.tab === "new" ? Promise.resolve([]) : loadRegister(tx, company.id, f.tab === "open"),
      f.tab === "new" ? loadRegisterItems(tx, company.id) : Promise.resolve([]),
      f.tab === "new" ? loadSoldierNames(tx, company.id) : Promise.resolve([]),
    ]);
    return { rows, items, soldiers };
  });

  const platoons = s.units.filter((u) => u.parentId === company.id && u.active).sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name));
  const platoonOf = (unitId: string | null) => (unitId ? (platoons.find((x) => lineage(unitId, s.parents).includes(x.id)) ?? null) : null);
  const mine = new Set(scope.platoons.map((x) => x.id));
  const touchesMine = (r: SigningRow) => mine.has(platoonOf(r.toUnitId)?.id ?? "") || mine.has(platoonOf(r.fromUnitId)?.id ?? "");
  const canReturn = (r: SigningRow) => scope.isAdmin || touchesMine(r);
  const shown = rows
    .filter((r) => !f.platoon || platoonOf(r.toUnitId)?.id === f.platoon || platoonOf(r.fromUnitId)?.id === f.platoon)
    .sort((a, b) => Number(touchesMine(b)) - Number(touchesMine(a)));
  const base = `/company/${company.id}/signings`;
  const who = (name: string | null, unitId: string | null) => (name ? [name, platoonOf(unitId)?.name].filter(Boolean).join(", ") : "הפלוגה");

  const gear: GearOption[] = items.map((i) => ({
    value: `${i.kind}:${i.id}`,
    dept: i.kind,
    name: i.name,
    serial: i.serial,
    category: i.category,
    where: i.kind === "company" && !i.serial ? `נשארו ${i.available} מתוך ${i.quantity}` : i.nowName ? `אצל ${who(i.nowName, i.nowUnitId)}` : "בפלוגה",
    available: i.kind === "company" && !i.serial ? i.available : null,
  }));
  // a platoon commander's own platoon first
  const people: PickPerson[] = soldiers
    .map((x) => ({ x, platoon: platoonOf(x.unitId) }))
    .sort((a, b) => Number(mine.has(b.platoon?.id ?? "")) - Number(mine.has(a.platoon?.id ?? "")))
    .map(({ x, platoon }) => ({ id: x.id, name: x.name, personalNumber: null, place: platoon?.name ?? "מפקדה" }));

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} path="/signings" />
      <PageHeader title="החתמות פנימיות" sub={`${company.name} · מי מחזיק עכשיו ציוד של הפלוגה. לא משנה את רישומי מחלקת הקשר והלוגיסטיקה.`} />
      <div className="flex flex-wrap items-center gap-3">
        <SegLinks
          label="תצוגה"
          items={[
            { href: withParams(base, { platoon: f.platoon }, {}), label: "פתוחות", on: f.tab === "open" },
            { href: withParams(base, { platoon: f.platoon }, { tab: "history" }), label: "היסטוריה", on: f.tab === "history" },
            { href: withParams(base, {}, { tab: "new" }), label: "חדש", on: f.tab === "new" },
          ]}
        />
        {f.tab !== "new" && platoons.length > 1 ? (
          <nav className="tz-pills" aria-label="מחלקה">
            <Link href={withParams(base, { tab: f.tab === "open" ? undefined : f.tab }, {})} className="tz-pill" aria-current={!f.platoon ? "page" : undefined}>
              הכול
            </Link>
            {platoons.map((pl) => (
              <Link key={pl.id} href={withParams(base, { tab: f.tab === "open" ? undefined : f.tab }, { platoon: pl.id })} className="tz-pill" aria-current={f.platoon === pl.id ? "page" : undefined}>
                {pl.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {f.tab === "new" ? (
        <Panel title="החתמה חדשה">
          {gear.length ? (
            <SignForm unitId={company.id} gear={gear} soldiers={people} />
          ) : (
            <Empty>אין ציוד לרישום: אין צ׳ של לוגיסטיקה או קשר על חיילי הפלוגה, ואין פריטי פלוגה פעילים.</Empty>
          )}
        </Panel>
      ) : (
        <Panel title={f.tab === "open" ? `פתוחות (${fmtCount(shown.length)})` : "היסטוריה"}>
          {shown.length === 0 ? (
            <Empty>{f.tab === "open" ? "אין ציוד שהוחתם בתוך הפלוגה כרגע." : "אין עדיין היסטוריה."}</Empty>
          ) : (
            <div className="tz-table-wrap">
              <table className="tz-table">
                <thead>
                  <tr>
                    <th>ציוד</th>
                    <th>אצל</th>
                    <th>ממי</th>
                    <th>{f.tab === "open" ? "מתי" : "תקופה"}</th>
                    <th>{f.tab === "open" ? "" : "סגר"}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="font-semibold">{r.item}</span>
                        {r.quantity > 1 ? <span className="tz-num"> × {r.quantity}</span> : null}
                        {r.serial ? (
                          <>
                            {" "}
                            <Serial>{r.serial}</Serial>
                          </>
                        ) : null}
                        {r.kind !== "company" ? <span className="tz-footnote"> · {GEAR_DEPT_LABEL[r.kind]}</span> : null}
                      </td>
                      <td>{who(r.toName, r.toUnitId)}</td>
                      <td>{who(r.fromName, r.fromUnitId)}</td>
                      <td className="tz-footnote">
                        {f.tab === "open" ? fmtWhen(r.signedAt, now) : `${fmtDateTime(r.signedAt)} – ${fmtDateTime(r.returnedAt)}`}
                        {r.signedByName ? ` · ${r.signedByName}` : ""}
                      </td>
                      <td>
                        {f.tab === "open" ? (
                          canReturn(r) ? (
                            <ActionButton action={returnInternal.bind(null, r.id)} label="הוחזר" confirmLabel="לאשר החזרה?" variant="tinted" />
                          ) : null
                        ) : (
                          <span className="tz-footnote">{r.returnedByName ?? ""}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
