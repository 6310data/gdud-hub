import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Icon, tintStyle } from "@gdud/ui";
import { PrintButton } from "@/components/print-button";
import { loadKesherReport, REPORT_KINDS, type ReportTable } from "@/lib/kesher/reports";
import { fmtCount } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";

export const metadata = { title: "דוח קשר" };

const searchSchema = z.object({ r: z.enum(REPORT_KINDS).catch("company"), unit: z.uuid().optional().catch(undefined) });

/** A report as a page to print or save as PDF; the same tables as its Excel file. */
export default async function KesherReportPrint({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireModule("kesher");
  const f = searchSchema.parse(await searchParams);
  const report = await loadKesherReport(s, f.r, f.unit);
  if (!report) notFound();
  const excel = `/kesher/reports/export?r=${f.r}${f.unit ? `&unit=${f.unit}` : ""}`;

  return (
    <article className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <div className="tz-no-print flex flex-wrap items-center gap-2">
        <Link href="/kesher/reports" className="tz-btn tz-btn-plain tz-btn-sm">
          <Icon name="chevron" size={14} className="rotate-180" />
          הפקת דוחות
        </Link>
        <span className="flex-1" />
        <a href={excel} className="tz-btn tz-btn-tinted tz-btn-sm" download>
          <Icon name="table" size={16} />
          Excel
        </a>
        <PrintButton />
      </div>
      <header className="flex flex-col">
        <h1 className="tz-title">{report.title}</h1>
        <span className="tz-footnote">{report.sub}</span>
      </header>
      {report.sheets.flatMap((sh) => sh.tables).map((t, i) => (
        <Table key={i} table={t} />
      ))}
      {report.receipt ? <Receipt text={report.receipt} /> : null}
    </article>
  );
}

const cell = (v: string | number | null) => (v === null || v === "" ? <span className="tz-zero">—</span> : typeof v === "number" ? fmtCount(v) : v);

function Table({ table: t }: { table: ReportTable }) {
  const num = (i: number) => t.rows.some((r) => typeof r[i] === "number") || typeof t.foot?.[i] === "number";
  return (
    <section className="flex flex-col gap-2 break-inside-avoid-page">
      {t.title ? <h2 className="tz-panel-title">{t.title}</h2> : null}
      <div className="tz-table-wrap">
        {t.rows.length ? (
          <table className="tz-table">
            <thead>
              <tr>
                {t.head.map((h, i) => (
                  <th key={i} className={t.tints?.[i] ? "tz-tint" : undefined} style={tintStyle(t.tints?.[i])}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((v, i) => (
                    <td key={i} className={`${num(i) ? "tz-num" : ""} ${t.tints?.[i] ? "tz-tint" : ""}`} style={tintStyle(t.tints?.[i])}>
                      {cell(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {t.foot ? (
              <tfoot>
                <tr>
                  {t.foot.map((v, i) => (
                    <td key={i} className={`${num(i) ? "tz-num" : ""} ${t.tints?.[i] ? "tz-tint" : ""}`} style={tintStyle(t.tints?.[i])}>
                      {v ?? ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        ) : (
          <div className="p-5 text-center text-[14px] text-ink-muted">אין נתונים</div>
        )}
      </div>
    </section>
  );
}

/** The receipt line a company report ends with. */
function Receipt({ text }: { text: string }) {
  return (
    <section className="tz-card flex flex-col gap-4 p-4 break-inside-avoid-page">
      <p className="m-0 text-[14px]">{text}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 text-[14px] md:grid-cols-4">
        {["שם", "מספר אישי", "תאריך", "חתימה"].map((k) => (
          <span key={k} className="flex flex-col gap-1">
            <span className="tz-label">{k}</span>
            <span className="h-6 border-b border-line-strong" />
          </span>
        ))}
      </div>
    </section>
  );
}
