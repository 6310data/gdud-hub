import "server-only";
import { byHe, emptyCounts, inArmory, sumCounts, type StockCounts, type UnitNode } from "@gdud/core";
import type { Tx } from "@gdud/db";
import { companiesOf, loadHoldings, loadPeople, loadStock } from "@/lib/logistics/data";

export interface SummaryColumn {
  key: string;
  label: string;
  /** link target in the roster */
  unitId?: string;
}

export interface SummaryMatrix {
  columns: SummaryColumn[];
  rows: Array<{ itemId: string; item: string; cells: number[]; inUnits: number; stock: StockCounts }>;
  totals: { cells: number[]; inUnits: number; stock: StockCounts };
}

const NONE = "__none";

/**
 * Items × companies (or × platoons of one company): signed counts from the open assignments
 * the user can see, plus the battalion stock columns (חתום / מחסן / חטיבה / סה״כ).
 */
export async function buildSummary(tx: Tx, units: readonly UnitNode[], companyId?: string): Promise<SummaryMatrix> {
  const [stock, holdings, people] = await Promise.all([loadStock(tx), loadHoldings(tx), loadPeople(tx, units, { includeInactive: true })]);
  const personById = new Map(people.map((p) => [p.id, p]));

  const keyOf = (personId: string): string | null => {
    const p = personById.get(personId);
    if (!p) return NONE;
    if (!companyId) return p.companyId ?? NONE;
    if (p.companyId !== companyId) return null; // other company: not in this view
    return p.platoonId ?? NONE;
  };

  const columns: SummaryColumn[] = companyId
    ? units
        .filter((u) => u.kind === "platoon" && u.active && u.parentId === companyId)
        .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name))
        .map((u) => ({ key: u.id, label: u.name, unitId: companyId }))
    : companiesOf(units).map((c) => ({ key: c.id, label: c.name, unitId: c.id }));

  const signed = new Map<string, Map<string, number>>(); // itemId → column → n
  for (const h of holdings) {
    const k = keyOf(h.personId);
    if (k === null) continue;
    const m = signed.get(h.itemId) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + 1);
    signed.set(h.itemId, m);
  }
  if ([...signed.values()].some((m) => m.has(NONE))) {
    columns.push({ key: NONE, label: companyId ? "ללא מחלקה" : "ללא פלוגה", unitId: companyId ?? "none" });
  }

  const rows = stock.items
    .map((it) => {
      const m = signed.get(it.id);
      const cells = columns.map((c) => m?.get(c.key) ?? 0);
      return { itemId: it.id, item: it.name, cells, inUnits: cells.reduce((a, b) => a + b, 0), stock: stock.counts.get(it.id) ?? emptyCounts() };
    })
    .filter((r) => (companyId ? r.inUnits > 0 : r.stock.total > 0));

  return {
    columns,
    rows,
    totals: {
      cells: columns.map((_, i) => rows.reduce((n, r) => n + r.cells[i]!, 0)),
      inUnits: rows.reduce((n, r) => n + r.inUnits, 0),
      stock: sumCounts(rows.map((r) => r.stock)),
    },
  };
}

/** CSV (Excel-friendly: BOM + CRLF) of the same table. */
export function summaryCsv(m: SummaryMatrix, inUnitsLabel?: string): string {
  const esc = (v: string | number) => {
    // a leading = + - @ would run as a formula in Excel / Sheets
    const s = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["פריט", ...m.columns.map((c) => c.label), ...(inUnitsLabel ? [inUnitsLabel] : []), "חתום", "מחסן", "חטיבה", "סה״כ"];
  const line = (label: string, cells: number[], inUnits: number, c: StockCounts) =>
    [label, ...cells, ...(inUnitsLabel ? [inUnits] : []), c.signed, inArmory(c), c.brigade, c.total].map(esc).join(",");
  return (
    "﻿" +
    [head.map(esc).join(","), ...m.rows.map((r) => line(r.item, r.cells, r.inUnits, r.stock)), line("סה״כ", m.totals.cells, m.totals.inUnits, m.totals.stock)].join("\r\n")
  );
}
