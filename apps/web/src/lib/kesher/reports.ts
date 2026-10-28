import "server-only";
/**
 * הפקת דוחות: the brigade report (the whole battalion's devices by category and place) and a company
 * report (the company's צ׳ with who holds them, its ציוד משלים against the תקן, a receipt line).
 * One model for both outputs: the print page (browser "save as PDF") and the Excel file.
 * Built from what the caller's RLS shows — holders only for the companies they cover.
 */
import { byHe, expandKit, KESHER_CONDITION_LABEL, type UnitNode } from "@gdud/core";
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
  if (x.location === "brigade") return "הוחזר לחטיבה";
  return companies.get(x.unitId ?? "")?.name ?? "פלוגה";
}

/**
 * דוח לחטיבה: devices only (the צ׳ table, no ציוד משלים), by category — counts per device type and
 * place, then every צ׳. Device types without a category come last ("ללא קטגוריה").
 */
export function brigadeReport(data: KesherData, companies: readonly UnitNode[], battalion: string, day: string): KesherReport {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const places: { id: string | null | "none"; name: string; color: string | null }[] = [
    { id: null, name: "במחסן", color: null },
    ...companies.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    { id: "none", name: "ללא שיוך", color: null },
  ];
  const where = (x: KSerial) => (x.location === "warehouse" ? null : x.location === "none" ? "none" : x.unitId);
  const category = (x: KSerial) => data.itemsById.get(x.itemId)?.category ?? "";
  const byCategory = (a: string, b: string) => (a ? (b ? byHe(a, b) : -1) : b ? 1 : 0);
  const cats = [...groupBy(data.serials, category)].sort(([a], [b]) => byCategory(a, b));

  const serialsTable: ReportTable = {
    title: "מכשירים לפי קטגוריה, סוג ומיקום",
    head: ["קטגוריה", "סוג מכשיר", ...places.map((p) => p.name), "מתוכם תקולים", "סה״כ"],
    tints: [null, null, ...places.map((p) => p.color), null, null],
    rows: cats.flatMap(([cat, inCat]) =>
      [...groupBy(inCat, (x) => x.itemName)]
        .sort(([a], [b]) => byHe(a, b))
        .map(([type, list]) => [
          cat || "ללא קטגוריה",
          type,
          ...places.map((p) => list.filter((x) => where(x) === p.id).length),
          list.filter((x) => x.condition === "broken").length,
          list.length,
        ]),
    ),
    foot: [
      "סה״כ",
      null,
      ...places.map((p) => data.serials.filter((x) => where(x) === p.id).length),
      data.serials.filter((x) => x.condition === "broken").length,
      data.serials.length,
    ],
  };

  const list = [...data.serials].sort(
    (a, b) => byCategory(category(a), category(b)) || byHe(a.itemName, b.itemName) || a.serial.localeCompare(b.serial, "en", { numeric: true }),
  );
  const listTable: ReportTable = {
    title: "פירוט המכשירים",
    head: ["קטגוריה", "סוג מכשיר", "צ׳", "מיקום", "מצב", "רכב", "חותם על הפלוגה", "תפקיד", "חתום בפלוגה", "מסגרת", "הערות"],
    rows: list.map((x) => [
      category(x) || "ללא קטגוריה",
      x.itemName,
      x.serial,
      placeName(x, byId),
      KESHER_CONDITION_LABEL[x.condition],
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
    sub: `נכון ל־${day} · ${data.serials.length} מכשירים · ${cats.length} קטגוריות`,
    file: "kesher-brigade",
    sheets: [
      { name: "סיכום", tables: [serialsTable] },
      { name: "פירוט מכשירים", tables: [listTable] },
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
