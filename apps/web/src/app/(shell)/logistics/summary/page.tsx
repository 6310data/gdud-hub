import Link from "next/link";
import { z } from "zod";
import { inArmory } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Icon } from "@gdud/ui";
import { companiesOf } from "@/lib/logistics/data";
import { fmtCount, fmtWhen } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";
import { Empty, NumCell, PageHeader, withParams } from "../_components/ui";
import { buildSummary } from "./matrix";

export const metadata = { title: "סיכום אמצעים" };

export default async function SummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("logistics");
  const sp = z.object({ unit: z.uuid().optional().catch(undefined) }).parse(await searchParams);
  const companies = companiesOf(s.units);
  const company = sp.unit ? companies.find((c) => c.id === sp.unit) : undefined;

  const m = await withUser(s.claims, (tx) => buildSummary(tx, s.units, company?.id));
  const t = m.totals.stock;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="סיכום אמצעים"
        sub={`${company ? `${company.name} · לפי מחלקה` : "כמויות לפי פריט ופלוגה"} · עודכן ${fmtWhen(now, now)}`}
        actions={
          <a href={withParams("/logistics/summary/export", {}, { unit: company?.id })} className="tz-btn tz-btn-tinted tz-btn-sm" download>
            <Icon name="table" size={16} />
            ייצוא לגיליון
          </a>
        }
      />

      <nav className="tz-pills" aria-label="תצוגה">
        <Link aria-current={(!company) ? "page" : undefined} className="tz-pill" href="/logistics/summary">
          כל הגדוד
        </Link>
        {companies.map((c) => (
          <Link key={c.id} aria-current={(company?.id === c.id) ? "page" : undefined} className="tz-pill" href={`/logistics/summary?unit=${c.id}`}>
            {c.name} · לפי מחלקה
          </Link>
        ))}
      </nav>

      {!company ? (
        <div className="tz-card grid grid-cols-2 sm:grid-cols-4">
          <Stat label="סה״כ צ׳ים" value={t.total} />
          <Stat label="מוחתמים על חיילים" value={t.signed} />
          <Stat label="במחסן" value={inArmory(t)} sub={`${fmtCount(t.ok)} תקין · ${fmtCount(t.broken)} תקול`} />
          <Stat label="בנשקיית חטיבה" value={t.brigade} />
        </div>
      ) : null}

      <div className="tz-table-wrap">
        {m.rows.length ? (
          <table className="tz-table">
            <thead>
              <tr>
                <th scope="col">פריט</th>
                {m.columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.unitId ? <Link href={`/logistics/people?unit=${c.unitId}`}>{c.label}</Link> : c.label}
                  </th>
                ))}
                {company ? <th scope="col">בפלוגה</th> : null}
                <th scope="col">חתום</th>
                <th scope="col">מחסן</th>
                <th scope="col">חטיבה</th>
                <th scope="col">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.itemId}>
                  <th scope="row">
                    <Link href={`/logistics/stock?item=${r.itemId}`} className="font-medium text-ink">
                      {r.item}
                    </Link>
                  </th>
                  {r.cells.map((n, i) => (
                    <NumCell key={m.columns[i]!.key} n={n} />
                  ))}
                  {company ? <NumCell n={r.inUnits} strong /> : null}
                  <NumCell n={r.stock.signed} />
                  <NumCell n={inArmory(r.stock)} />
                  <NumCell n={r.stock.brigade} />
                  <NumCell n={r.stock.total} strong />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">סה״כ</th>
                {m.totals.cells.map((n, i) => (
                  <NumCell key={m.columns[i]!.key} n={n} />
                ))}
                {company ? <NumCell n={m.totals.inUnits} /> : null}
                <NumCell n={t.signed} />
                <NumCell n={inArmory(t)} />
                <NumCell n={t.brigade} />
                <NumCell n={t.total} />
              </tr>
            </tfoot>
          </table>
        ) : (
          <Empty>{company ? `אין ציוד מוחתם ב${company.name}` : "אין עדיין צ׳ים במלאי"}</Empty>
        )}
      </div>
      <span className="tz-footnote">
        ״מחסן״ כולל צ׳ים תקינים ותקולים. עמודות הפלוגות מציגות רק חיילים במסגרות שלך. לחיצה על שם פלוגה פותחת את האלפון שלה.
      </span>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <span className="flex flex-col gap-0.5 border-separator px-4 py-3.5 [&:not(:last-child)]:border-e">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="tz-num text-[22px] font-semibold">{fmtCount(value)}</span>
      {sub ? <span className="text-xs text-ink-muted">{sub}</span> : null}
    </span>
  );
}
