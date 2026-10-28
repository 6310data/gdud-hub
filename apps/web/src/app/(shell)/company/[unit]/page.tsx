import Link from "next/link";
import { z } from "zod";
import { formatPhone, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { Empty, PageHeader, Panel, withParams } from "@/components/page-parts";
import { StatusChip } from "@/app/(shell)/doch1/_components/status-chip";
import { SearchBox } from "@/app/(shell)/kesher/_components/ui";
import { requireCompanyScope } from "@/lib/company/access";
import { loadChangeRequests, loadRoster, subtreeIds } from "@/lib/company/data";
import { fmtCount } from "@/lib/logistics/format";
import { ChangeRequests, CompanyPills } from "../_components/ui";

export const metadata = { title: "הפלוגה" };

const paramsSchema = z.object({ unit: z.uuid() });
const searchSchema = z.object({
  platoon: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
});

/**
 * הפלוגה: the roster of what the user covers (a company admin: the company; a platoon commander:
 * their platoon) — today's דוח 1 status, how many items are signed on each soldier, the phone. A
 * soldier opens their אני view, read-only. A platoon commander also decides their platoon's
 * name / תפקיד requests here (a company admin does it in הגדרות).
 */
export default async function CompanyRoster({
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
  const platoons = s.units.filter((u) => u.parentId === company.id && u.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const myPlatoons = scope.isAdmin ? platoons : scope.platoons;
  const platoon = myPlatoons.find((x) => x.id === f.platoon);
  const now = new Date();

  const { roster, changes } = await withUser(s.claims, async (tx) => {
    const [roster, changes] = await Promise.all([
      loadRoster(tx, company.id, s.units),
      scope.isAdmin ? Promise.resolve([]) : loadChangeRequests(tx, myPlatoons.flatMap((x) => subtreeIds(x.id, s.units))),
    ]);
    return { roster, changes };
  });

  const inPlatoon = platoon ? new Set(subtreeIds(platoon.id, s.units)) : null;
  const shown = roster.filter((r) => (!inPlatoon || inPlatoon.has(r.unitId)) && (!f.q || matches(f.q, r.fullName, r.roleTitle, r.phone)));
  const base = `/company/${company.id}`;
  const unitName = (id: string) => s.units.find((u) => u.id === id)?.name ?? "";
  const missing = shown.filter((r) => !r.statusName).length;
  // one card per platoon (a header instead of the platoon name on every row); company-level soldiers first
  const platoonOfRow = (unitId: string) => platoons.find((x) => subtreeIds(x.id, s.units).includes(unitId)) ?? null;
  const groups = [
    { key: "hq", name: `${company.name} · מפקדה`, platoonId: null as string | null },
    ...platoons.map((x) => ({ key: x.id, name: x.name, platoonId: x.id as string | null })),
  ]
    .map((g) => {
      const rows = shown.filter((r) => (platoonOfRow(r.unitId)?.id ?? null) === g.platoonId);
      return { ...g, rows, missing: rows.filter((r) => !r.statusName).length };
    })
    .filter((g) => g.rows.length);

  return (
    <>
      <CompanyPills companies={access.companies} current={company.id} />
      <PageHeader
        title={company.name}
        sub={`${fmtCount(shown.length)} חיילים${missing ? ` · ${fmtCount(missing)} בלי דוח 1 היום` : ""}${scope.isAdmin ? "" : ` · ${myPlatoons.map((x) => x.name).join(", ")}`}`}
      />

      {!scope.isAdmin && changes.length ? (
        <Panel title="בקשות לעדכון פרטים במחלקה">
          <ChangeRequests rows={changes} place={unitName} now={now} selfId={access.personId} />
        </Panel>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {myPlatoons.length > 1 ? (
          <nav className="tz-pills" aria-label="מחלקה">
            <Link href={withParams(base, { q: f.q }, {})} className="tz-pill" aria-current={!platoon ? "page" : undefined}>
              הכול <span className="tz-pill-count">{roster.length}</span>
            </Link>
            {myPlatoons.map((x) => (
              <Link key={x.id} href={withParams(base, { q: f.q }, { platoon: x.id })} className="tz-pill" aria-current={platoon?.id === x.id ? "page" : undefined}>
                {x.name} <span className="tz-pill-count">{roster.filter((r) => subtreeIds(x.id, s.units).includes(r.unitId)).length}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        <SearchBox action={base} q={f.q} placeholder="חיפוש שם, תפקיד או טלפון" keep={{ platoon: platoon?.id }} />
      </div>

      {shown.length === 0 ? (
        <Panel>
          <Empty>{roster.length ? "אין חיילים שמתאימים לחיפוש." : "אין חיילים פעילים בפלוגה."}</Empty>
        </Panel>
      ) : (
        groups.map((g) => (
          <Panel
            key={g.key}
            title={g.name}
            action={
              <span className="tz-footnote">
                {fmtCount(g.rows.length)} חיילים{g.missing ? ` · ${fmtCount(g.missing)} בלי דוח 1` : ""}
              </span>
            }
          >
            {g.rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-[var(--separator)] px-4 py-2.5 last:border-b-0">
                <Link href={`${base}/people/${r.id}`} className="flex min-w-0 flex-1 flex-col text-ink no-underline">
                  <span className="truncate font-semibold">
                    {r.fullName}
                    {r.linked ? null : <span className="tz-footnote font-normal"> · בלי חשבון</span>}
                  </span>
                  <span className="tz-footnote truncate">
                    {[r.roleTitle, r.gear ? `${r.gear} פריטי ציוד` : null].filter(Boolean).join(" · ") || "—"}
                  </span>
                </Link>
                <StatusChip status={r.statusName ? { name: r.statusName, color: r.statusColor ?? "#8e8e93" } : null} />
                {r.phone ? (
                  <a href={`tel:${r.phone}`} className="tz-icon-btn flex-none" aria-label={`התקשרות ל${r.fullName} — ${formatPhone(r.phone)}`} title={formatPhone(r.phone)}>
                    <Icon name="phone" size={18} />
                  </a>
                ) : (
                  <span className="size-9 flex-none" aria-hidden="true" />
                )}
              </div>
            ))}
          </Panel>
        ))
      )}
    </>
  );
}
