import Link from "next/link";
import { z } from "zod";
import { formatPhone, matches } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Chip } from "@gdud/ui";
import { Empty, PageHeader, Panel, withParams } from "@/components/page-parts";
import { StatusChip } from "@/app/(shell)/doch1/_components/status-chip";
import { SearchBox, SegLinks } from "@/app/(shell)/kesher/_components/ui";
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

      <div className="flex flex-wrap items-center gap-3">
        {myPlatoons.length > 1 ? (
          <SegLinks
            label="מחלקה"
            items={[
              { href: withParams(base, { q: f.q }, {}), label: "הכול", on: !platoon },
              ...myPlatoons.map((x) => ({ href: withParams(base, { q: f.q }, { platoon: x.id }), label: x.name, on: platoon?.id === x.id })),
            ]}
          />
        ) : null}
        <SearchBox action={base} q={f.q} placeholder="חיפוש שם, תפקיד או טלפון" keep={{ platoon: platoon?.id }} />
      </div>

      <Panel>
        {shown.length === 0 ? (
          <Empty>{roster.length ? "אין חיילים שמתאימים לחיפוש." : "אין חיילים פעילים בפלוגה."}</Empty>
        ) : (
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מחלקה</th>
                  <th>תפקיד</th>
                  <th>דוח 1 היום</th>
                  <th>ציוד</th>
                  <th>טלפון</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`${base}/people/${r.id}`} className="font-semibold">
                        {r.fullName}
                      </Link>
                      {r.linked ? null : (
                        <>
                          {" "}
                          <Chip tone="signed">בלי חשבון</Chip>
                        </>
                      )}
                    </td>
                    <td>{r.platoonName ?? "—"}</td>
                    <td>{r.roleTitle ?? "—"}</td>
                    <td>
                      <StatusChip status={r.statusName ? { name: r.statusName, color: r.statusColor ?? "#8e8e93" } : null} />
                    </td>
                    <td className="tz-num">{r.gear || "—"}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`} className="tz-serial">{formatPhone(r.phone)}</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
