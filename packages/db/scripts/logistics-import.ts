/**
 * Import of the old logistics Google Sheet (CSV exports) into the new tables.
 * The CLI is scripts/import-logistics.ts; this half has no side effects at load time so
 * test/import-logistics.test.ts can run it against PGlite.
 *
 * Sheet layouts: the header of references/logistics/Code.gs. Every sheet has one header row.
 * Idempotent: rows that already exist (same serial, same open assignment, same storage row,
 * same person by personal number / name) are skipped, so it is safe to run again.
 * Everything runs in one transaction; a dry run rolls it back at the end.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeSerial, parseKitText, searchKey, type Condition, type KitLine } from "@gdud/core";
import type { Db, Tx } from "../src/index";
import {
  cell,
  nameKey,
  parseCsv,
  parseSheetDate,
  SHEET_NAMES,
  statusToCondition,
  toSheetRows,
  type SheetKey,
  type SheetRow,
  type Sheets,
} from "../src/logistics-sheet/index";
import * as schema from "../src/schema/index";

const { units, people } = schema;
const { logisticsItems: items, logisticsKitItems: kitItems, logisticsSerials: serials } = schema;
const { logisticsAssignments: assignments, logisticsStorage: storage } = schema;

export interface ImportIssue {
  sheet: string;
  row: number;
  message: string;
}
export interface Count {
  created: number;
  existing: number;
}
export const COUNT_KEYS = ["platoons", "people", "items", "kitItems", "serials", "assignments", "storage"] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export interface ImportReport {
  dryRun: boolean;
  counts: Record<CountKey, Count>;
  /** rows that were NOT imported */
  skipped: ImportIssue[];
  /** rows that were imported but deserve a look (e.g. an item created on the fly) */
  warnings: ImportIssue[];
  unknownCompanies: string[];
}

const ITEM_NAME_MAX = 80;
const SERIAL_MAX = 40;
const INSERT_CHUNK = 500;

/* ── CSV folder ──────────────────────────────────────────────────────────── */

/**
 * Finds each sheet's CSV in `folder`. Google Sheets names a download
 * "<spreadsheet> - <sheet>.csv"; a file named just "<sheet>.csv" works too.
 */
export function readSheets(folder: string): { sheets: Sheets; found: Partial<Record<SheetKey, string>>; missing: SheetKey[] } {
  const files = readdirSync(folder).filter((f) => /\.csv$/i.test(f));
  const sheets: Sheets = {};
  const found: Partial<Record<SheetKey, string>> = {};
  const missing: SheetKey[] = [];
  for (const key of Object.keys(SHEET_NAMES) as SheetKey[]) {
    const name = SHEET_NAMES[key];
    const file = files.find((f) => {
      const base = f.normalize("NFC").replace(/\.csv$/i, "").trim();
      return base === name || base.endsWith(` - ${name}`);
    });
    if (!file) {
      missing.push(key);
      continue;
    }
    found[key] = file;
    sheets[key] = toSheetRows(parseCsv(readFileSync(path.join(folder, file), "utf8")));
  }
  return { sheets, found, missing };
}

/* ── cell helpers ────────────────────────────────────────────────────────── */

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ── importer ────────────────────────────────────────────────────────────── */

interface PersonRef {
  id: string;
  fullName: string;
  personalNumber: string | null;
}
interface PersonInput {
  name: string;
  pid: string;
  company: string;
  platoon: string;
  phone?: string;
}
interface SerialRef {
  id: string;
  itemId: string;
}
type At = { sheet: SheetKey; row: number };

class DryRunRollback extends Error {}

const emptyReport = (dryRun: boolean): ImportReport => ({
  dryRun,
  counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, { created: 0, existing: 0 }])) as Record<CountKey, Count>,
  skipped: [],
  warnings: [],
  unknownCompanies: [],
});

/** Runs the whole import in one transaction. `dryRun` rolls it back after counting. */
export async function importLogistics(
  db: { transaction: Db["transaction"] },
  sheets: Sheets,
  opts: { dryRun: boolean },
): Promise<ImportReport> {
  const report = emptyReport(opts.dryRun);
  try {
    await db.transaction(async (tx) => {
      const importer = new Importer(tx as Tx, report);
      await importer.load();
      await importer.run(sheets);
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}

class Importer {
  private battalionId = "";
  private readonly companies = new Map<string, string>(); // searchKey(name) → id
  private readonly platoons = new Map<string, string>(); // companyId|searchKey(name) → id
  private readonly peopleById = new Map<string, PersonRef>();
  private readonly peopleByPid = new Map<string, PersonRef>();
  private readonly peopleByName = new Map<string, PersonRef[]>();
  private readonly items = new Map<string, string>(); // name → id
  private readonly itemNames = new Map<string, string>(); // id → name
  private readonly kit = new Set<string>(); // itemId|name
  private readonly serials = new Map<string, SerialRef>(); // normalized serial → row
  private readonly openAssignments = new Map<string, string>(); // serialId → personId
  private readonly storageKeys = new Set<string>();
  private readonly openStorage = new Set<string>(); // serialId

  constructor(
    private readonly tx: Tx,
    private readonly report: ImportReport,
  ) {}

  async load() {
    const unitRows = await this.tx.select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name }).from(units);
    const root = unitRows.find((u) => u.parentId === null && u.kind === "battalion");
    if (!root) throw new Error("No battalion unit in the database — run bootstrap-admin first");
    this.battalionId = root.id;
    for (const u of unitRows) if (u.kind === "company" && u.parentId === root.id) this.companies.set(searchKey(u.name), u.id);
    for (const u of unitRows) if (u.kind === "platoon" && u.parentId) this.platoons.set(`${u.parentId}|${searchKey(u.name)}`, u.id);

    const ppl = await this.tx.select({ id: people.id, fullName: people.fullName, personalNumber: people.personalNumber }).from(people);
    ppl.forEach((p) => this.remember(p));

    for (const i of await this.tx.select({ id: items.id, name: items.name }).from(items)) this.rememberItem(i.id, i.name);
    for (const k of await this.tx.select({ itemId: kitItems.itemId, name: kitItems.name }).from(kitItems)) this.kit.add(`${k.itemId}|${k.name}`);
    for (const s of await this.tx.select({ id: serials.id, serial: serials.serial, itemId: serials.itemId }).from(serials)) {
      this.serials.set(s.serial, { id: s.id, itemId: s.itemId });
    }
    const asg = await this.tx.select({ serialId: assignments.serialId, personId: assignments.personId, returnedAt: assignments.returnedAt }).from(assignments);
    for (const a of asg) if (!a.returnedAt) this.openAssignments.set(a.serialId, a.personId);
    const st = await this.tx
      .select({ personId: storage.personId, serialId: storage.serialId, itemName: storage.itemName, storedAt: storage.storedAt, releasedAt: storage.releasedAt })
      .from(storage);
    for (const s of st) {
      this.storageKeys.add(storageKey(s.personId, s.serialId, s.itemName, s.storedAt));
      if (s.serialId && !s.releasedAt) this.openStorage.add(s.serialId);
    }
  }

  async run(sheets: Sheets) {
    // people before module data; serials before the kit (a kit may name an item that is only in 'טבלת צ')
    await this.importCatalogue(sheets.dropdowns ?? []);
    await this.importPeople(sheets.people ?? []);
    await this.importSerials(sheets.serials ?? []);
    await this.importKit(sheets.kit ?? []);
    await this.importAssignments(sheets.assignments ?? []);
    await this.importStorage(sheets.storage ?? []);
  }

  /* ── reporting ── */

  private skip(at: At, message: string) {
    this.report.skipped.push({ sheet: SHEET_NAMES[at.sheet], row: at.row, message });
  }
  private warn(at: At, message: string) {
    this.report.warnings.push({ sheet: SHEET_NAMES[at.sheet], row: at.row, message });
  }
  private count(key: CountKey, created: boolean) {
    this.report.counts[key][created ? "created" : "existing"]++;
  }

  /* ── lookups ── */

  private remember(p: PersonRef) {
    this.peopleById.set(p.id, p);
    if (p.personalNumber) this.peopleByPid.set(p.personalNumber, p);
    const key = nameKey(p.fullName);
    this.peopleByName.set(key, [...(this.peopleByName.get(key) ?? []), p]);
  }

  private rememberItem(id: string, name: string) {
    this.items.set(name, id);
    this.itemNames.set(id, name);
  }

  private companyId(name: string, at: At): string | undefined {
    if (!name) {
      this.skip(at, "חסרה פלוגה – אי אפשר ליצור את החייל");
      return undefined;
    }
    const id = this.companies.get(searchKey(name));
    if (id) return id;
    if (!this.report.unknownCompanies.includes(name)) this.report.unknownCompanies.push(name);
    this.skip(at, `פלוגה לא מוכרת "${name}" – הוסף אותה ביחידות והרץ שוב`);
    return undefined;
  }

  /** The soldier's unit: the platoon if given (created under the company when missing), else the company. */
  private async unitId(company: string, platoon: string, at: At): Promise<string | undefined> {
    const companyId = this.companyId(company, at);
    if (!companyId || !platoon) return companyId;
    const key = `${companyId}|${searchKey(platoon)}`;
    const existing = this.platoons.get(key);
    if (existing) return existing;
    const [created] = await this.tx.insert(units).values({ parentId: companyId, kind: "platoon", name: nameKey(platoon) }).returning({ id: units.id });
    this.platoons.set(key, created!.id);
    this.count("platoons", true);
    return created!.id;
  }

  /** Match by personal number, then by full name; create when missing. */
  private async person(input: PersonInput, at: At): Promise<{ person: PersonRef; created: boolean } | undefined> {
    const name = nameKey(input.name);
    const pid = normalizeSerial(input.pid);
    const byPid = pid ? this.peopleByPid.get(pid) : undefined;
    if (byPid) return { person: byPid, created: false };
    if (!name) {
      this.skip(at, "חסר שם חייל");
      return undefined;
    }
    // with a personal number, a same-named soldier who has a different one is someone else
    const sameName = (this.peopleByName.get(name) ?? []).filter((p) => !pid || !p.personalNumber);
    if (sameName.length > 1) {
      this.skip(at, `יש כמה חיילים בשם "${name}" – הוסף מס׳ אישי כדי להבחין ביניהם`);
      return undefined;
    }
    if (sameName[0]) return { person: sameName[0], created: false };

    const unitId = await this.unitId(input.company, input.platoon, at);
    if (!unitId) return undefined;
    const [row] = await this.tx
      .insert(people)
      .values({ unitId, fullName: name, personalNumber: pid || null, phone: input.phone || null })
      .returning({ id: people.id, fullName: people.fullName, personalNumber: people.personalNumber });
    this.remember(row!);
    this.count("people", true);
    return { person: row!, created: true };
  }

  /** Item id by exact name; creates the item (with a warning) when `create` is set. */
  private async item(name: string, at: At, create?: { category: string | null }): Promise<string | undefined> {
    const existing = this.items.get(name);
    if (existing) return existing;
    if (!name) {
      this.skip(at, "חסר שם פריט");
      return undefined;
    }
    if (name.length > ITEM_NAME_MAX) {
      this.skip(at, `שם פריט ארוך מדי (${name.length} תווים, מקסימום ${ITEM_NAME_MAX})`);
      return undefined;
    }
    if (!create) {
      this.skip(at, `פריט "${name}" לא קיים בקטלוג`);
      return undefined;
    }
    const [row] = await this.tx.insert(items).values({ name, category: create.category }).returning({ id: items.id });
    this.rememberItem(row!.id, name);
    this.count("items", true);
    this.warn(at, `פריט "${name}" לא היה ב-Dropdowns – נוצר`);
    return row!.id;
  }

  /* ── sheets ── */

  /** 'Dropdowns': A = company (checked against units), C–F = category, subcategory, sku, item. */
  private async importCatalogue(rows: SheetRow[]) {
    for (const r of rows) {
      const at: At = { sheet: "dropdowns", row: r.row };
      const company = cell(r, 1);
      if (company && !this.companies.has(searchKey(company))) {
        if (!this.report.unknownCompanies.includes(company)) this.report.unknownCompanies.push(company);
        this.warn(at, `פלוגה "${company}" לא קיימת ביחידות`);
      }
      const name = cell(r, 6);
      if (!name) continue;
      if (this.items.has(name)) {
        this.count("items", false);
        continue;
      }
      if (name.length > ITEM_NAME_MAX) {
        this.skip(at, `שם פריט ארוך מדי (${name.length} תווים, מקסימום ${ITEM_NAME_MAX})`);
        continue;
      }
      const [row] = await this.tx
        .insert(items)
        .values({ name, category: cell(r, 3) || null, subcategory: cell(r, 4) || null, sku: cell(r, 5) || null })
        .returning({ id: items.id });
      this.rememberItem(row!.id, name);
      this.count("items", true);
    }
  }

  /** 'אלפון גדודי': full name, personal number, first, last, company, platoon, phone. */
  private async importPeople(rows: SheetRow[]) {
    for (const r of rows) {
      const at: At = { sheet: "people", row: r.row };
      const name = cell(r, 1) || `${cell(r, 3)} ${cell(r, 4)}`;
      const res = await this.person({ name, pid: cell(r, 2), company: cell(r, 5), platoon: cell(r, 6), phone: cell(r, 7) }, at);
      if (res && !res.created) this.count("people", false);
    }
  }

  /** 'טבלת צ': category, item, serial, status. */
  private async importSerials(rows: SheetRow[]) {
    const pending = new Map<string, typeof serials.$inferInsert>();
    for (const r of rows) {
      const at: At = { sheet: "serials", row: r.row };
      const serial = normalizeSerial(cell(r, 3));
      if (!serial) {
        this.skip(at, "חסר צ׳");
        continue;
      }
      if (this.serials.has(serial) || pending.has(serial)) {
        this.count("serials", false);
        continue;
      }
      if (serial.length > SERIAL_MAX) {
        this.skip(at, `צ׳ ${serial} ארוך מדי`);
        continue;
      }
      const condition = statusToCondition(cell(r, 4));
      if (!condition) {
        this.skip(at, `סטטוס לא מוכר "${cell(r, 4)}" (צ׳ ${serial})`);
        continue;
      }
      const category = cell(r, 1) || null;
      const itemId = await this.item(cell(r, 2), at, { category });
      if (!itemId) continue;
      pending.set(serial, { itemId, serial, category, condition });
    }
    for (const part of chunks([...pending.values()], INSERT_CHUNK)) {
      const rows = await this.tx.insert(serials).values(part).returning({ id: serials.id, serial: serials.serial, itemId: serials.itemId });
      for (const s of rows) this.serials.set(s.serial, { id: s.id, itemId: s.itemId });
      this.report.counts.serials.created += rows.length;
    }
  }

  /** 'תקן ציוד משלים': item, accessory name, qty. */
  private async importKit(rows: SheetRow[]) {
    const order = new Map<string, number>();
    for (const r of rows) {
      const at: At = { sheet: "kit", row: r.row };
      const name = cell(r, 2);
      if (!name) {
        this.skip(at, "חסר שם פריט משלים");
        continue;
      }
      const itemId = await this.item(cell(r, 1), at);
      if (!itemId) continue;
      const sortOrder = order.get(itemId) ?? 0;
      order.set(itemId, sortOrder + 1);
      if (this.kit.has(`${itemId}|${name}`)) {
        this.count("kitItems", false);
        continue;
      }
      const qty = Math.min(99, Math.max(1, Math.round(Number(cell(r, 3)) || 1)));
      await this.tx.insert(kitItems).values({ itemId, name, qty, sortOrder });
      this.kit.add(`${itemId}|${name}`);
      this.count("kitItems", true);
    }
  }

  /** A serial seen in 'גדודי' / 'אפסון' but missing from 'טבלת צ' is created (with a warning). */
  private async serialFor(serial: string, itemName: string, at: At): Promise<SerialRef | undefined> {
    const existing = this.serials.get(serial);
    if (existing) return existing;
    if (serial.length > SERIAL_MAX) {
      this.skip(at, `צ׳ ${serial} ארוך מדי`);
      return undefined;
    }
    const itemId = await this.item(itemName, at, { category: null });
    if (!itemId) return undefined;
    const [row] = await this.tx.insert(serials).values({ itemId, serial }).returning({ id: serials.id, itemId: serials.itemId });
    this.serials.set(serial, row!);
    this.count("serials", true);
    this.warn(at, `צ׳ ${serial} לא היה בטבלת צ – נוצר`);
    return row!;
  }

  /** 'גדודי': company, platoon, name, personal number, item, serial, notes, kit text → open assignments. */
  private async importAssignments(rows: SheetRow[]) {
    const pending: Array<typeof assignments.$inferInsert> = [];
    for (const r of rows) {
      const at: At = { sheet: "assignments", row: r.row };
      const serial = normalizeSerial(cell(r, 6));
      if (!serial) {
        this.skip(at, "חסר צ׳ – אי אפשר להחתים פריט בלי צ׳");
        continue;
      }
      const res = await this.person({ name: cell(r, 3), pid: cell(r, 4), company: cell(r, 1), platoon: cell(r, 2) }, at);
      if (!res) continue;
      const ref = await this.serialFor(serial, cell(r, 5), at);
      if (!ref) continue;
      const holder = this.openAssignments.get(ref.id);
      if (holder === res.person.id) {
        this.count("assignments", false);
        continue;
      }
      if (holder) {
        this.skip(at, `צ׳ ${serial} כבר מוחתם על ${this.peopleById.get(holder)?.fullName ?? "חייל אחר"}`);
        continue;
      }
      const kit: KitLine[] = parseKitText(cell(r, 8));
      pending.push({ serialId: ref.id, personId: res.person.id, notes: cell(r, 7) || null, kit });
      this.openAssignments.set(ref.id, res.person.id);
    }
    for (const part of chunks(pending, INSERT_CHUNK)) await this.tx.insert(assignments).values(part);
    this.report.counts.assignments.created += pending.length;
  }

  /** 'אפסון': company, name, personal number, item, serial, in date, out date (filled = released). */
  private async importStorage(rows: SheetRow[]) {
    const pending: Array<typeof storage.$inferInsert> = [];
    for (const r of rows) {
      const at: At = { sheet: "storage", row: r.row };
      const row = await this.storageRow(r, at);
      if (!row) continue;
      const key = storageKey(row.personId, row.serialId ?? null, row.itemName, row.storedAt!);
      if (this.storageKeys.has(key)) {
        this.count("storage", false);
        continue;
      }
      if (row.serialId && !row.releasedAt) {
        if (this.openStorage.has(row.serialId)) {
          this.skip(at, `צ׳ ${cell(r, 5)} כבר באפסון`);
          continue;
        }
        if (this.openAssignments.get(row.serialId) !== row.personId) this.warn(at, `צ׳ ${cell(r, 5)} באפסון אבל לא מוחתם על החייל`);
        this.openStorage.add(row.serialId);
      }
      this.storageKeys.add(key);
      pending.push(row);
    }
    for (const part of chunks(pending, INSERT_CHUNK)) await this.tx.insert(storage).values(part);
    this.report.counts.storage.created += pending.length;
  }

  private async storageRow(r: SheetRow, at: At): Promise<(typeof storage.$inferInsert & { storedAt: Date }) | undefined> {
    const raw = normalizeSerial(cell(r, 5));
    const serial = raw === "0" ? "" : raw; // '0' marked an item without a serial
    const ref = serial ? this.serials.get(serial) : undefined;
    if (serial && !ref) {
      this.skip(at, `צ׳ ${serial} לא קיים בטבלת צ`);
      return undefined;
    }
    const itemName = cell(r, 4) || (ref ? this.itemNames.get(ref.itemId) : undefined) || "";
    if (!itemName) {
      this.skip(at, "חסר פריט");
      return undefined;
    }
    const storedAt = parseSheetDate(cell(r, 6));
    if (!storedAt) {
      this.skip(at, cell(r, 6) ? `תאריך אפסון לא תקין "${cell(r, 6)}"` : "חסר תאריך אפסון");
      return undefined;
    }
    const out = cell(r, 7);
    const releasedAt = out ? parseSheetDate(out) : null;
    if (releasedAt === undefined) {
      this.skip(at, `תאריך הוצאה לא תקין "${out}"`);
      return undefined;
    }
    const res = await this.person({ name: cell(r, 2), pid: cell(r, 3), company: cell(r, 1), platoon: "" }, at);
    if (!res) return undefined;
    return { personId: res.person.id, serialId: ref?.id ?? null, itemName, storedAt, releasedAt };
  }
}

function storageKey(personId: string, serialId: string | null, itemName: string, storedAt: Date): string {
  return `${personId}|${serialId ?? ""}|${itemName}|${storedAt.getTime()}`;
}

/* ── output ──────────────────────────────────────────────────────────────── */

const COUNT_LABEL: Record<CountKey, string> = {
  platoons: "מחלקות",
  people: "חיילים",
  items: "פריטים",
  kitItems: "תקן ציוד משלים",
  serials: "צ׳ים",
  assignments: "החתמות פתוחות",
  storage: "אפסון",
};

export function formatReport(report: ImportReport): string {
  const lines = [report.dryRun ? "DRY RUN — nothing was written" : "Import committed", ""];
  for (const key of COUNT_KEYS) {
    const c = report.counts[key];
    lines.push(`  ${COUNT_LABEL[key].padEnd(16)} new ${String(c.created).padStart(5)}   already there ${String(c.existing).padStart(5)}`);
  }
  if (report.unknownCompanies.length) {
    lines.push("", `Unknown companies (add them under the battalion in /admin/units, then re-run): ${report.unknownCompanies.join(", ")}`);
  }
  const list = (title: string, issues: ImportIssue[]) => {
    if (!issues.length) return;
    lines.push("", `${title} (${issues.length}):`);
    for (const i of issues) lines.push(`  ${i.sheet} row ${i.row}: ${i.message}`);
  };
  list("Skipped rows", report.skipped);
  list("Warnings", report.warnings);
  return lines.join("\n");
}
