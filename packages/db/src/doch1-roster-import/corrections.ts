/**
 * "קובץ תיקונים לגדוד": the decisions that disagree with the battalion's list, as an xlsx the
 * clerk sends back. Built on request from the plan and the decisions; never stored.
 */
import type { RosterField, RosterMatch } from "@gdud/core";
import ExcelJS from "exceljs";
import type { RosterDecisions } from "./apply";
import type { RosterPlan } from "./plan";

export interface CorrectionRow {
  kind: string;
  personalNumber: string;
  name: string;
  field: string;
  battalion: string;
  ours: string;
}

const FIELD_LABEL: Record<RosterField, string> = { name: "שם", unit: "פלוגה / מחלקה", phone: "טלפון", role: "תפקיד בפועל" };

/** The disagreements, one row per soldier and field. `unitName` names a unit id (or a platoon to create). */
export function corrections(plan: RosterPlan, decisions: RosterDecisions, unitName: (id: string) => string): CorrectionRow[] {
  const add = new Set(decisions.add);
  const keep = new Set(decisions.keepMissing);
  const out: CorrectionRow[] = [];
  const value = (m: RosterMatch, f: RosterField, side: "battalion" | "ours"): string => {
    if (f === "name") return side === "battalion" ? m.row.fullName : m.member.fullName;
    if (f === "unit") return unitName(side === "battalion" ? m.row.unitId : m.member.unitId);
    if (f === "phone") return (side === "battalion" ? m.row.phone : m.member.phone) ?? "";
    return (side === "battalion" ? m.row.role : m.member.role) ?? "";
  };
  for (const m of [...plan.diff.changed, ...plan.diff.returning.filter((x) => add.has(x.row.personalNumber))]) {
    const taken = new Set(decisions.take[m.row.personalNumber] ?? []);
    for (const f of m.fields) {
      if (taken.has(f)) continue;
      out.push({ kind: "פרט שונה, נשאר אצלנו", personalNumber: m.row.personalNumber, name: m.member.fullName, field: FIELD_LABEL[f], battalion: value(m, f, "battalion"), ours: value(m, f, "ours") });
    }
  }
  for (const m of plan.diff.missing.filter((x) => keep.has(x.personId))) {
    out.push({ kind: "לא ברשימת הגדוד, נשאר בסבב", personalNumber: m.personalNumber ?? "", name: m.fullName, field: "", battalion: "", ours: unitName(m.unitId) });
  }
  for (const r of plan.diff.added.filter((x) => !add.has(x.personalNumber))) {
    out.push({ kind: "ברשימת הגדוד, לא נכלל בסבב", personalNumber: r.personalNumber, name: r.fullName, field: "", battalion: unitName(r.unitId), ours: "" });
  }
  for (const m of plan.diff.returning.filter((x) => !add.has(x.row.personalNumber))) {
    out.push({ kind: "ברשימת הגדוד, לא נכלל בסבב", personalNumber: m.row.personalNumber, name: m.member.fullName, field: "", battalion: unitName(m.row.unitId), ours: "" });
  }
  for (const p of plan.diff.problems) out.push({ kind: "שורה בעייתית בקובץ", personalNumber: "", name: "", field: `שורה ${p.line}`, battalion: p.message, ours: "" });
  return out;
}

export async function correctionsWorkbook(rows: readonly CorrectionRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("תיקונים", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "סוג", key: "kind", width: 28 },
    { header: "מספר אישי", key: "personalNumber", width: 12 },
    { header: "שם", key: "name", width: 22 },
    { header: "שדה", key: "field", width: 16 },
    { header: "ברשימת הגדוד", key: "battalion", width: 24 },
    { header: "אצלנו", key: "ours", width: 24 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
