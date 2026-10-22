/**
 * Sheet + app state → the list of change lines the preview shows. Reads the database (through
 * the caller's transaction, so RLS applies) and writes nothing.
 *
 * Soldiers are never created or edited here: דוח 1 owns them. A row for a soldier the app
 * doesn't have becomes an error line.
 */
import { CONDITION_LABEL, normalizeSerial } from "@gdud/core";
import type { Tx } from "../index";
import { cell, nameKey, statusToCondition, type SheetKey, type SheetRow, type Sheets } from "./sheet";
import { loadState, type PersonRef, type State } from "./state";
import type { ChangeLine, ChangeOp, LineGroup, SheetDiff } from "./types";

export const ITEM_NAME_MAX = 80;
export const SERIAL_MAX = 40;

export const MSG = {
  noSoldier: "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1",
  itemDiffers: "סוג הפריט שונה מהאפליקציה — לתיקון ידני",
  inUse: "בשימוש – לא ניתן למחוק",
  itemNotInDropdowns: "פריט לא היה ב-Dropdowns",
  serialNotInTable: "צ׳ לא היה בטבלת צ",
} as const;

const dash = (v: string | null) => v ?? "—";
const catalogueText = (c: string | null, s: string | null, k: string | null) => `${dash(c)} / ${dash(s)} / ${dash(k)}`;

interface LineFields {
  key: string;
  item?: string | null;
  serial?: string | null;
  personName?: string | null;
  before?: string | null;
  after?: string | null;
  message?: string | null;
  dependsOn?: string[];
}
type ErrorFields = Omit<LineFields, "key" | "before" | "after" | "message" | "dependsOn">;
/** Lines the new row needs first, or why it can't be read. */
type Needs = { dependsOn: string[] } | { error: string };

class Differ {
  readonly lines: ChangeLine[] = [];
  readonly identical: Partial<Record<SheetKey, number>> = {};
  /** item name → id of the line that creates it in this diff */
  private readonly plannedItems = new Map<string, string>();
  /** serial → the line that creates it in this diff */
  private readonly plannedSerials = new Map<string, { lineId: string; itemName: string }>();
  /** 'אלפון גדודי': nameKey(name) → personal number, only to find a soldier's personal number */
  private readonly alfon = new Map<string, string>();

  constructor(
    private readonly st: State,
    alfonRows: readonly SheetRow[],
  ) {
    for (const r of alfonRows) {
      const name = nameKey(cell(r, 1) || `${cell(r, 3)} ${cell(r, 4)}`);
      const pid = normalizeSerial(cell(r, 2));
      if (name && pid && !this.alfon.has(name)) this.alfon.set(name, pid);
    }
  }

  /* ── line builders ── */

  private push(sheet: SheetKey, row: number | null, group: LineGroup, op: ChangeOp, f: LineFields): string {
    const id = `${sheet}:${op.t}:${f.key}`;
    this.lines.push({
      id,
      sheet,
      row,
      group,
      kind: op.t,
      item: f.item ?? null,
      serial: f.serial ?? null,
      personName: f.personName ?? null,
      before: f.before ?? null,
      after: f.after ?? null,
      message: f.message ?? null,
      selectable: true,
      defaultOn: group !== "appOnly",
      dependsOn: f.dependsOn ?? [],
      op,
    });
    return id;
  }

  /** An app-only row the import won't remove: listed for information. */
  private info(sheet: SheetKey, kind: ChangeOp["t"], f: LineFields) {
    this.lines.push({
      id: `${sheet}:${kind}:${f.key}`,
      sheet,
      row: null,
      group: "appOnly",
      kind,
      item: f.item ?? null,
      serial: f.serial ?? null,
      personName: f.personName ?? null,
      before: null,
      after: null,
      message: f.message ?? null,
      selectable: false,
      defaultOn: false,
      dependsOn: [],
      op: null,
    });
  }

  private error(sheet: SheetKey, row: number, message: string, f: ErrorFields = {}) {
    this.lines.push({
      id: `${sheet}:error:${row}`,
      sheet,
      row,
      group: "error",
      kind: "error",
      item: f.item ?? null,
      serial: f.serial ?? null,
      personName: f.personName ?? null,
      before: null,
      after: null,
      message,
      selectable: false,
      defaultOn: false,
      dependsOn: [],
      op: null,
    });
  }

  private same(sheet: SheetKey) {
    this.identical[sheet] = (this.identical[sheet] ?? 0) + 1;
  }

  /* ── lookups ── */

  /**
   * By personal number; else the row's name → its personal number in the אלפון; else the one
   * app soldier with that name. A same-named soldier with a different personal number is someone else.
   */
  private person(name: string, pidText: string): { person: PersonRef } | { error: string } {
    const n = nameKey(name);
    const pid = normalizeSerial(pidText);
    const byPid = pid ? this.st.peopleByPid.get(pid) : undefined;
    if (byPid) return { person: byPid };
    const alfonPid = n ? this.alfon.get(n) : undefined;
    const byAlfon = alfonPid ? this.st.peopleByPid.get(alfonPid) : undefined;
    if (byAlfon) return { person: byAlfon };
    if (!n) return { error: pid ? MSG.noSoldier : "חסר שם חייל" };
    const sameName = (this.st.peopleByName.get(n) ?? []).filter((p) => !pid || !p.personalNumber);
    if (sameName.length > 1) return { error: `יש כמה חיילים בשם "${n}" – הוסף מס׳ אישי` };
    if (sameName[0]) return { person: sameName[0] };
    return { error: MSG.noSoldier };
  }

  /** The item a new row needs: in the app, created earlier in this diff, or (if `create`) created now. */
  private item(
    name: string,
    at: { sheet: SheetKey; row: number },
    create?: { category: string | null; message: string },
  ): Needs {
    if (this.st.itemsByName.has(name)) return { dependsOn: [] };
    const planned = this.plannedItems.get(name);
    if (planned) return { dependsOn: [planned] };
    if (!name) return { error: "חסר שם פריט" };
    if (name.length > ITEM_NAME_MAX) return { error: `שם פריט ארוך מדי (${name.length} תווים, מקסימום ${ITEM_NAME_MAX})` };
    if (!create) return { error: `פריט "${name}" לא קיים בקטלוג` };
    const op: ChangeOp = { t: "item.add", name, category: create.category, subcategory: null, sku: null };
    const id = this.push(at.sheet, at.row, "new", op, { key: name, item: name, message: create.message });
    this.plannedItems.set(name, id);
    return { dependsOn: [id] };
  }

  private itemName(itemId: string): string {
    return this.st.itemsById.get(itemId)?.name ?? "";
  }

  /* ── tabs ── */

  /** 'Dropdowns': A = company (not used), C–F = category, subcategory, sku, item. */
  dropdowns(rows: readonly SheetRow[]) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const name = cell(r, 6);
      if (!name) continue;
      const first = seen.get(name);
      if (first) {
        this.error("dropdowns", r.row, `הפריט מופיע פעמיים (גם בשורה ${first})`, { item: name });
        continue;
      }
      seen.set(name, r.row);
      if (name.length > ITEM_NAME_MAX) {
        this.error("dropdowns", r.row, `שם פריט ארוך מדי (${name.length} תווים, מקסימום ${ITEM_NAME_MAX})`, { item: name });
        continue;
      }
      const category = cell(r, 3) || null;
      const subcategory = cell(r, 4) || null;
      const sku = cell(r, 5) || null;
      const app = this.st.itemsByName.get(name);
      if (!app) {
        const id = this.push("dropdowns", r.row, "new", { t: "item.add", name, category, subcategory, sku }, { key: name, item: name });
        this.plannedItems.set(name, id);
      } else if (app.category !== category || app.subcategory !== subcategory || app.sku !== sku) {
        this.push("dropdowns", r.row, "change", { t: "item.update", itemId: app.id, category, subcategory, sku }, {
          key: name,
          item: name,
          before: catalogueText(app.category, app.subcategory, app.sku),
          after: catalogueText(category, subcategory, sku),
        });
      } else this.same("dropdowns");
    }
  }

  /** 'טבלת צ': category, item, serial, status. */
  serials(rows: readonly SheetRow[]) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const serial = normalizeSerial(cell(r, 3));
      const itemName = cell(r, 2);
      const f = { item: itemName || null, serial: serial || null };
      if (!serial) {
        this.error("serials", r.row, "חסר צ׳", f);
        continue;
      }
      const first = seen.get(serial);
      if (first) {
        this.error("serials", r.row, `הצ׳ מופיע פעמיים (גם בשורה ${first})`, f);
        continue;
      }
      seen.set(serial, r.row);
      const status = cell(r, 4);
      const condition = statusToCondition(status);
      if (!condition) {
        this.error("serials", r.row, `סטטוס לא מוכר "${status}" (צ׳ ${serial})`, f);
        continue;
      }
      // "חתום" (and a blank status) says where it isn't, not what state it is in
      const carriesCondition = !["", "חתום"].includes(nameKey(status));

      const app = this.st.serialsBySerial.get(serial);
      if (app) {
        if (itemName && itemName !== this.itemName(app.itemId)) {
          this.error("serials", r.row, MSG.itemDiffers, f);
        } else if (carriesCondition && condition !== app.condition) {
          this.push("serials", r.row, "change", { t: "serial.condition", serialId: app.id, condition }, {
            key: serial,
            item: this.itemName(app.itemId),
            serial,
            before: CONDITION_LABEL[app.condition],
            after: CONDITION_LABEL[condition],
          });
        } else this.same("serials");
        continue;
      }

      if (serial.length > SERIAL_MAX) {
        this.error("serials", r.row, `צ׳ ${serial} ארוך מדי`, f);
        continue;
      }
      const category = cell(r, 1) || null;
      const needs = this.item(itemName, { sheet: "serials", row: r.row }, { category, message: MSG.itemNotInDropdowns });
      if ("error" in needs) {
        this.error("serials", r.row, needs.error, f);
        continue;
      }
      const lineId = this.push("serials", r.row, "new", { t: "serial.add", serial, itemName, category, condition }, {
        key: serial,
        ...f,
        dependsOn: needs.dependsOn,
      });
      this.plannedSerials.set(serial, { lineId, itemName });
    }

    for (const s of this.st.serialsBySerial.values()) {
      if (seen.has(s.serial)) continue;
      const f = { key: s.serial, item: this.itemName(s.itemId), serial: s.serial };
      if (this.st.usedSerials.has(s.id)) this.info("serials", "serial.delete", { ...f, message: MSG.inUse });
      else this.push("serials", null, "appOnly", { t: "serial.delete", serialId: s.id }, f);
    }
  }

  /** 'תקן ציוד משלים': item, accessory name, qty. */
  kit(rows: readonly SheetRow[]) {
    const seen = new Map<string, number>();
    const order = new Map<string, number>();
    for (const r of rows) {
      const itemName = cell(r, 1);
      const name = cell(r, 2);
      if (!name) {
        this.error("kit", r.row, "חסר שם פריט משלים", { item: itemName || null });
        continue;
      }
      const needs = this.item(itemName, { sheet: "kit", row: r.row });
      if ("error" in needs) {
        this.error("kit", r.row, needs.error, { item: itemName || null });
        continue;
      }
      const key = `${itemName}|${name}`;
      const first = seen.get(key);
      if (first) {
        this.error("kit", r.row, `השורה מופיעה פעמיים (גם בשורה ${first})`, { item: itemName });
        continue;
      }
      seen.set(key, r.row);
      const sortOrder = order.get(itemName) ?? 0;
      order.set(itemName, sortOrder + 1);
      if (this.st.kit.some((k) => k.name === name && this.itemName(k.itemId) === itemName)) {
        this.same("kit");
        continue;
      }
      const qty = Math.min(99, Math.max(1, Math.round(Number(cell(r, 3)) || 1)));
      this.push("kit", r.row, "new", { t: "kit.add", itemName, name, qty, sortOrder }, {
        key,
        item: itemName,
        after: qty > 1 ? `${qty} ${name}` : name,
        dependsOn: needs.dependsOn,
      });
    }
    for (const k of this.st.kit) {
      const itemName = this.itemName(k.itemId);
      const key = `${itemName}|${k.name}`;
      if (seen.has(key)) continue;
      this.push("kit", null, "appOnly", { t: "kit.remove", kitItemId: k.id }, { key, item: itemName, before: k.name });
    }
  }
}

/**
 * Only the tabs in `tabs` (and present in `sheets`) produce lines. The אלפון tab never does; when
 * present it is only used to find a soldier's personal number by name.
 */
export async function diffLogistics(tx: Tx, sheets: Sheets, tabs: readonly SheetKey[]): Promise<SheetDiff> {
  const st = await loadState(tx);
  const d = new Differ(st, sheets.people ?? []);
  const chosen = (k: SheetKey) => tabs.includes(k) && sheets[k] !== undefined;
  // catalogue before serials before kit: a later tab may need an item / serial created by an earlier one
  if (chosen("dropdowns")) d.dropdowns(sheets.dropdowns!);
  if (chosen("serials")) d.serials(sheets.serials!);
  if (chosen("kit")) d.kit(sheets.kit!);
  return { lines: d.lines, identical: d.identical, fingerprint: "" };
}
