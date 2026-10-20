/**
 * The printable sign-out / holdings form (replaces the Drive PDFs of the old app).
 * Pure and hook-free: used by the saved-form page, the holdings preview and the sign-out preview.
 * "Save as PDF" is the browser's print dialog.
 */
import { lineTotals, type LogisticsFormData } from "@gdud/core";
import { fmtDate, fmtDateTime } from "@/lib/logistics/format";

export function FormDocument({ data, kind }: { data: LogisticsFormData; kind: "signout" | "holdings" }) {
  const ext = kind === "holdings";
  const p = data.person;
  const totals = ext && data.lines.length > 1 ? lineTotals(data.lines) : [];
  const meta: Array<[string, string]> = [
    ["שם מלא", p.name],
    ["מספר אישי", p.personalNumber ?? "—"],
    ["פלוגה", p.company ?? "—"],
    ["מחלקה", p.platoon ?? "—"],
    ["טלפון", p.phone ?? "—"],
    ["מספר פריטים", String(data.lines.length)],
    [data.signerTitle, data.signer || "—"],
    ["הופק ע״י", data.issuedBy || "—"],
  ];

  return (
    <article className="logistics-form mx-auto w-full max-w-[794px] bg-surface p-8 text-[13px] leading-normal text-ink print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 16mm; } .logistics-form tr { break-inside: avoid; } .logistics-form thead { display: table-header-group; }`}</style>
      <header className="mb-3.5 flex items-end justify-between border-b-2 border-primary pb-2">
        <div>
          <h1 className="m-0 text-[22px] font-bold text-primary">{data.title}</h1>
          <div className="text-xs text-ink-muted">{data.battalion}</div>
        </div>
        <div className="text-xs text-ink-muted">תאריך: {fmtDateTime(data.issuedAt)}</div>
      </header>

      <dl className="m-0 mb-3.5 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3.5 gap-y-1.5 rounded-control bg-ground px-3 py-2.5">
        {meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-primary">{k}</dt>
            <dd className="m-0">{k === "מספר אישי" || k === "טלפון" ? <span className="tz-serial text-[13px]">{v}</span> : v}</dd>
          </div>
        ))}
      </dl>

      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-primary text-white">
            {["#", "פריט", "צ׳", "ציוד משלים", ...(ext ? ["הערות", "תאריך החתמה"] : [])].map((h) => (
              <th key={h} className="border border-line-strong px-2 py-1.5 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 ? (
            <tr>
              <td colSpan={ext ? 6 : 4} className="border border-separator p-3 text-center text-ink-muted">
                אין ציוד מוחתם
              </td>
            </tr>
          ) : null}
          {data.lines.map((l, i) => (
            <tr key={`${l.serial}-${i}`}>
              <td className="w-7 border border-separator px-2 py-1.5 text-center text-ink-muted">{i + 1}</td>
              <td className="border border-separator px-2 py-1.5">{l.item}</td>
              <td className="border border-separator px-2 py-1.5">
                <span className="tz-serial text-[13px]">{l.serial}</span>
              </td>
              <td className="border border-separator px-2 py-1.5 text-xs">{l.kit || "—"}</td>
              {ext ? (
                <>
                  <td className="border border-separator px-2 py-1.5 text-xs">{l.notes}</td>
                  <td className="border border-separator px-2 py-1.5 text-xs">{l.signedAt ? fmtDate(l.signedAt) : ""}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {totals.length ? (
        <p className="mt-2.5 text-xs">
          <b>סיכום לפי פריט:</b> {totals.map((t) => `${t.item} × ${t.count}`).join(" · ")}
        </p>
      ) : null}
      {data.notes ? (
        <p className="mt-3 rounded-tile border border-dashed border-line-strong px-2.5 py-2">
          <b>הערות:</b> {data.notes}
        </p>
      ) : null}
      <p className="mt-4 text-xs leading-relaxed">{data.declaration}</p>
      <div className="mt-9 flex justify-between gap-8 text-xs text-ink-muted">
        <div className="flex-1 border-t border-ink pt-1.5">
          חתימת {ext ? "החייל" : "המקבל"}: {p.name}
        </div>
        <div className="flex-1 border-t border-ink pt-1.5">
          חתימת ה{data.signerTitle}: {data.signer}
        </div>
      </div>
      <footer className="mt-6 text-center text-[11px] text-ink-muted">הופק ממערכת הלוגיסטיקה הגדודית · {fmtDateTime(data.issuedAt)}</footer>
    </article>
  );
}
