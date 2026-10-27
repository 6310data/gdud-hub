import "server-only";
/** The reports screen as an Excel workbook: one sheet per report, the same numbers as the page. */
import { DATA_CHECK_LABEL, DATA_CHECKS } from "@gdud/core";
import type { XlsxSheet, XlsxTable } from "@gdud/db/xlsx";
import { fmtDay } from "./format";
import type { ReportsData } from "./reports";

export function reportSheets(data: ReportsData): XlsxSheet[] {
  const r = data.reports;
  const company = new Map(data.companies.map((c) => [c.id, c.name]));
  const location = new Map(data.locations.map((l) => [l.id, l.name]));
  const status = new Map(data.statuses.map((s) => [s.id, s.name]));
  const needsOutpost = [...new Set(data.statuses.filter((s) => s.active && s.needsOutpost).map((s) => s.name))].join(" / ") || "דורש מוצב";
  const when = `${fmtDay(data.day)} · ${data.round.name}`;
  const { outposts, camps } = r.outposts;

  const r1: XlsxTable = {
    title: `דוח 1 לפי מסגרת ומיקום · ${when}`,
    head: ["פלוגה", "מיקום", ...r.criticalRoles.columns, "סה״כ", "מעבר לגבול"],
    rows: r.criticalRoles.rows.map((x) => [company.get(x.companyId) ?? "", location.get(x.locationId) ?? "", ...x.counts, x.total, x.acrossBorder]),
    foot: ["סה״כ", "", ...r.criticalRoles.total.counts, r.criticalRoles.total.total, r.criticalRoles.total.acrossBorder],
  };

  const r2: XlsxTable = {
    title: `15א · ${when}`,
    head: ["פלוגה", ...outposts.map((o) => o.name), `סה״כ ${needsOutpost}`, "מהם ללא מוצב", ...camps.map((c) => c.name), "סה״כ"],
    rows: r.outposts.rows.map((x) => [company.get(x.companyId) ?? "", ...x.outposts, x.needsOutpost, x.noOutpost, ...x.camps, x.total]),
    foot: ["סה״כ", ...r.outposts.total.outposts, r.outposts.total.needsOutpost, r.outposts.total.noOutpost, ...r.outposts.total.camps, r.outposts.total.total],
  };

  const r3: XlsxTable[] = r.camps.map((c) => ({
    title: `10א · ${c.location.name} · ${when}`,
    head: ["יחידה", "מפקד", "מספר"],
    rows: [...c.rows.map((x) => [x.name, x.commander, x.count]), ...(c.unassigned ? [["יחידה ללא שיוך", null, c.unassigned]] : [])],
    foot: ["סה״כ", null, c.total],
  }));

  const person = (id: string) => data.people.get(id);
  const listedName = r.categories.filter((c) => c.listed).map((c) => c.name).join(" / ");
  const r4: XlsxTable = {
    title: `${listedName} · ${when}`,
    head: ["שם", "מספר אישי", "פלוגה", "מסגרת", "מיקום בשבצ״ק", "סטטוס", "זמין"],
    rows: r.listed.map((x) => {
      const p = person(x.personId);
      return [p?.name ?? "", p?.personalNumber ?? null, p?.company ?? "", p?.platoon ?? null, p?.location ?? "לא בשבצ״ק", x.statusId ? (status.get(x.statusId) ?? "") : "חסר", x.available ? "כן" : "לא"];
    }),
  };

  const r5: XlsxTable = {
    title: `בקרת נתונים · ${when}`,
    head: ["פלוגה", "ברשימה", "לא בשמ״פ", "חסרי דיווח", "בשמ״פ", "דורש מוצב ללא מוצב", "במוצב בסטטוס אחר", "בשבצ״ק"],
    rows: r.control.map((x) => [company.get(x.companyId) ?? "", x.rows, x.offDuty, x.missing, x.onDuty, x.noOutpost, x.atOutpostOther, x.inShabzak]),
  };

  const checks: XlsxTable = {
    title: `בדיקות נתונים · ${when}`,
    head: ["בדיקה", "שם", "מספר אישי", "פלוגה", "מסגרת", "מיקום בשבצ״ק", "סטטוס"],
    rows: DATA_CHECKS.flatMap((k) =>
      r.checks[k].map((id) => {
        const p = person(id);
        const st = data.dayStatuses.get(id);
        return [DATA_CHECK_LABEL[k], p?.name ?? "", p?.personalNumber ?? null, p?.company ?? "", p?.platoon ?? null, p?.location ?? null, st ? (status.get(st) ?? "") : null];
      }),
    ),
  };

  const { columns } = r.sadak;
  const sadak: XlsxTable = {
    title: `סד״כ לפי מסגרת · ${when}`,
    head: ["פלוגה", "מסגרת", ...columns.outposts.map((o) => o.name), "ללא מוצב", ...columns.statuses.map((s) => s.name), "חסר דיווח", "סה״כ"],
    rows: r.sadak.rows.map((x) => [
      company.get(x.companyId) ?? "",
      x.platoonId ? (data.platoonNames.get(x.platoonId) ?? "") : "ברמת הפלוגה",
      ...x.outposts,
      x.noOutpost,
      ...x.statuses,
      x.missing,
      x.total,
    ]),
    foot: ["סה״כ", "", ...r.sadak.total.outposts, r.sadak.total.noOutpost, ...r.sadak.total.statuses, r.sadak.total.missing, r.sadak.total.total],
  };

  return [
    { name: "לפי מסגרת ומיקום", tables: [r1] },
    { name: "15א", tables: [r2] },
    ...(r3.length ? [{ name: "10א", tables: r3 }] : []),
    ...(listedName ? [{ name: listedName, tables: [r4] }] : []),
    { name: "בקרת נתונים", tables: [r5, checks] },
    { name: "סד״כ לפי מסגרת", tables: [sadak] },
  ];
}
