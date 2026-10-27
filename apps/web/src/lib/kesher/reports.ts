import "server-only";
/**
 * הפקת דוחות: the brigade report (the whole battalion's צ׳ and ציוד משלים by place) and a company
 * report (the company's צ׳ with who holds them, its ציוד משלים against the תקן, a receipt line).
 * One model for both outputs: the print page (browser "save as PDF") and the Excel file.
 * Built from what the caller's RLS shows — holders only for the companies they cover.
 */
import { byHe, expandKit, type UnitNode } from "@gdud/core";
import { withUser } from "@gdud/db";
import type { XlsxSheet, XlsxTable, XlsxValue } from "@gdud/db/xlsx";
import { battalionName, companiesOf } from "@/lib/logistics/data";
import { fmtDate } from "@/lib/logistics/format";
import type { Session } from "@/lib/session";
import { kesherAccess } from "./access";
import { groupBy, loadKesher, stockKey, type KesherData, type KSerial } from "./data";

/** A table, with each head column's company color (print view only). */
export interface ReportTable extends XlsxTable {
  tints?: (string | null)[];
}
export interface ReportSheet extends XlsxSheet {
  tables: ReportTable[];
}
export interface KesherReport {
  title: string;
  sub: string;
  /** file name without extension (ASCII; the Hebrew name goes in filename*) */
  file: string;
  sheets: ReportSheet[];
  /** a company report ends with a receipt line to sign */
  receipt?: string;
}

const dash = (v: string | null | undefined): XlsxValue => v || null;
const signer = (x: KSerial) => dash(x.holder?.signer?.name);

function placeName(x: KSerial, companies: ReadonlyMap<string, UnitNode>): string {
  if (x.location === "warehouse") return "במחסן";
  if (x.location === "none") return "ללא שיוך";
  return companies.get(x.unitId ?? "")?.name ?? "פלוגה";
}

/** דוח לחטיבה: counts by device type and place, ציוד משלים against the brigade receipt, every צ׳. */
export function brigadeReport(data: KesherData, companies: readonly UnitNode[], battalion: string, day: string): KesherReport {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const places: { id: string | null | "none"; name: string; color: string | null }[] = [
    { id: null, name: "במחסן", color: null },
    ...companies.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    { id: "none", name: "ללא שיוך", color: null },
  ];
  const where = (x: KSerial) => (x.location === "warehouse" ? null : x.location === "none" ? "none" : x.unitId);
  const types = [...groupBy(data.serials, (x) => x.itemName)].sort(([a], [b]) => byHe(a, b));

  const serialsTable: ReportTable = {
    title: "צ׳ לפי סוג מכשיר ומיקום",
    head: ["סוג מכשיר", ...places.map((p) => p.name), "סה״כ"],
    tints: [null, ...places.map((p) => p.color), null],
    rows: types.map(([type, list]) => [type, ...places.map((p) => list.filter((x) => where(x) === p.id).length), list.length]),
    foot: ["סה״כ", ...places.map((p) => data.serials.filter((x) => where(x) === p.id).length), data.serials.length],
  };

  const bulk = data.items.filter((i) => i.kind === "bulk");
  const stockPlaces = places.filter((p) => p.id !== "none") as { id: string | null; name: string; color: string | null }[];
  const qty = (itemId: string, unitId: string | null) => data.stock.get(stockKey(itemId, unitId)) ?? 0;
  const total = (itemId: string) => stockPlaces.reduce((n, p) => n + qty(itemId, p.id), 0);
  const stockTable: ReportTable = {
    title: data.warehouseTracked ? "ציוד משלים לפי מיקום" : "ציוד משלים לפי מיקום (מלאי המחסן לא מנוהל)",
    head: ["פריט", "קטגוריה", ...stockPlaces.map((p) => p.name), "סה״כ בגדוד", "מלאי קבלות חטיבה", "הפרש"],
    tints: [null, null, ...stockPlaces.map((p) => p.color), null, null, null],
    rows: bulk.map((i) => [
      i.name,
      dash(i.category),
      ...stockPlaces.map((p) => qty(i.id, p.id)),
      total(i.id),
      i.brigadeQty,
      i.brigadeQty === null ? null : total(i.id) - i.brigadeQty,
    ]),
    foot: ["סה״כ", null, ...stockPlaces.map((p) => bulk.reduce((n, i) => n + qty(i.id, p.id), 0)), bulk.reduce((n, i) => n + total(i.id), 0), null, null],
  };

  const order = new Map(places.map((p, i) => [p.id, i]));
  const list = [...data.serials].sort((a, b) => (order.get(where(a)) ?? 0) - (order.get(where(b)) ?? 0) || byHe(a.itemName, b.itemName));
  const listTable: ReportTable = {
    title: "פירוט הצ׳",
    head: ["סוג מכשיר", "צ׳", "מיקום", "האמר", "חותם על הפלוגה", "תפקיד", "חתום בפלוגה", "מסגרת", "הערות"],
    rows: list.map((x) => [
      x.itemName,
      x.serial,
      placeName(x, byId),
      dash(x.vehicle),
      signer(x),
      dash(x.holder?.signerRole),
      dash(x.holder?.holder?.name),
      dash(x.holder?.frame),
      dash(x.notes),
    ]),
  };

  return {
    title: `דוח קשר לחטיבה · ${battalion}`,
    sub: `נכון ל־${day} · ${data.serials.length} צ׳ · ${bulk.length} סוגי ציוד משלים`,
    file: "kesher-brigade",
    sheets: [
      { name: "סיכום", tables: [serialsTable, stockTable] },
      { name: "פירוט צ׳", tables: [listTable] },
    ],
  };
}

/** דוח פלוגתי (the old wa_coReport): the company's צ׳ by device type, its ציוד משלים, a receipt line. */
export function companyReport(data: KesherData, company: UnitNode, day: string): KesherReport {
  const mine = data.serials.filter((x) => x.location === "company" && x.unitId === company.id);
  const types = [...groupBy(mine, (x) => x.itemName)].sort(([a], [b]) => byHe(a, b));

  const summary: ReportTable = {
    title: "סיכום לפי סוג מכשיר",
    head: ["סוג מכשיר", "צ׳", "משויכים בפלוגה"],
    rows: types.map(([type, list]) => [type, list.length, list.filter((x) => x.holder?.holder).length]),
    foot: ["סה״כ", mine.length, mine.filter((x) => x.holder?.holder).length],
  };
  const serials: ReportTable = {
    title: "צ׳ על הפלוגה",
    head: ["סוג מכשיר", "צ׳", "חתום בפלוגה", "תפקיד", "מסגרת", "חותם על הפלוגה", "האמר"],
    rows: types.flatMap(([, list]) =>
      list.map((x) => [x.itemName, x.serial, dash(x.holder?.holder?.name), dash(x.holder?.holderRole), dash(x.holder?.frame), signer(x), dash(x.vehicle)]),
    ),
  };

  const std = expandKit(new Map(types.map(([type, list]) => [type, list.length])), data.kits);
  const bulk = data.items.filter((i) => i.kind === "bulk" && ((data.stock.get(stockKey(i.id, company.id)) ?? 0) || std.get(i.name)));
  const comp: ReportTable = {
    title: "ציוד משלים",
    head: ["פריט", "חתומים", "לפי תקן", "פער"],
    rows: bulk.map((i) => {
      const have = data.stock.get(stockKey(i.id, company.id)) ?? 0;
      const want = std.get(i.name) ?? 0;
      return [i.name, have, want, have - want];
    }),
  };

  return {
    title: `רשימת ציוד קשר · ${company.name}`,
    sub: `נכון ל־${day} · ${mine.length} צ׳ · ${bulk.length} סוגי ציוד משלים`,
    file: "kesher-company",
    sheets: [{ name: company.name, tables: [summary, serials, ...(comp.rows.length ? [comp] : [])] }],
    receipt: `אני מאשר/ת שהציוד המפורט לעיל חתום על ${company.name}.`,
  };
}

export const REPORT_KINDS = ["brigade", "company"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * The report a user asked for, or null when they may not have it: the brigade report needs a
 * battalion-wide kesher membership; a company report, a company they cover.
 */
export async function loadKesherReport(s: Session, kind: ReportKind, unitId?: string | null): Promise<KesherReport | null> {
  const access = kesherAccess(s);
  const day = fmtDate(new Date());
  if (kind === "brigade") {
    if (!access.allCompanies) return null;
    const data = await withUser(s.claims, (tx) => loadKesher(tx, s.units));
    return brigadeReport(data, companiesOf(s.units), battalionName(s.units), day);
  }
  const company = access.companies.find((c) => c.id === unitId);
  if (!company) return null;
  const data = await withUser(s.claims, (tx) => loadKesher(tx, s.units));
  return companyReport(data, company, day);
}
