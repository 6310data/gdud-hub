/**
 * Sheet + app state → the list of change lines the preview shows. Reads the database (through
 * the caller's transaction, so RLS applies) and writes nothing.
 *
 * Soldiers are never created or edited here: דוח 1 owns them. A row for a soldier the app
 * doesn't have becomes an error line.
 */
import { createHash } from "node:crypto";
import { cleanKit, CONDITION_LABEL, kitToString, normalizeSerial, parseKitText } from "@gdud/core";
import type { Tx } from "../index";
import { MSG } from "./preview";
import {
  cell,
  formatSheetDate,
  nameKey,
  parseSheetDate,
  sheetDay,
  statusToCondition,
  type SheetKey,
  type SheetRow,
  type Sheets,
} from "./sheet";
import { loadState, type PersonRef, type State, type StorageRef } from "./state";
import type { ChangeLine, ChangeOp, LineGroup, SheetDiff } from "./types";

export const ITEM_NAME_MAX = 80;
export const SERIAL_MAX = 40;

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

  /** 'טבלת צ': category, item, serial, status. `inOtherTabs` = serials the chosen גדודי / אפסון rows name. */
  serials(rows: readonly SheetRow[], inOtherTabs: ReadonlySet<string>) {
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
      // a serial that another chosen tab still lists would be signed / stored and deleted in one go
      if (this.st.usedSerials.has(s.id)) this.info("serials", "serial.delete", { ...f, message: MSG.inUse });
      else if (inOtherTabs.has(s.serial)) this.info("serials", "serial.delete", { ...f, message: MSG.inSheet });
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

  /**
   * The serial a new row needs: in the app (no dependency), created earlier in this diff, or
   * created now from this row (a צ׳ that is only in 'גדודי').
   */
  private serialFor(serial: string, itemName: string, at: { sheet: SheetKey; row: number }, f: ErrorFields): Needs {
    if (this.st.serialsBySerial.has(serial)) return { dependsOn: [] };
    const planned = this.plannedSerials.get(serial);
    if (planned) return { dependsOn: [planned.lineId] };
    if (serial.length > SERIAL_MAX) return { error: `צ׳ ${serial} ארוך מדי` };
    const needs = this.item(itemName, at, { category: null, message: MSG.itemNotInDropdowns });
    if ("error" in needs) return needs;
    const op: ChangeOp = { t: "serial.add", serial, itemName, category: null, condition: "ok" };
    const lineId = this.push(at.sheet, at.row, "new", op, { key: serial, ...f, message: MSG.serialNotInTable, dependsOn: needs.dependsOn });
    this.plannedSerials.set(serial, { lineId, itemName });
    return { dependsOn: [lineId] };
  }

  /** 'גדודי': company, platoon, name, personal number, item, serial, notes, kit text → open assignments. */
  assignments(rows: readonly SheetRow[]) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const serial = normalizeSerial(cell(r, 6));
      const itemName = cell(r, 5);
      const f = { item: itemName || null, serial: serial || null, personName: nameKey(cell(r, 3)) || null };
      if (!serial) {
        this.error("assignments", r.row, "חסר צ׳ – אי אפשר להחתים פריט בלי צ׳", f);
        continue;
      }
      const first = seen.get(serial);
      if (first) {
        this.error("assignments", r.row, `הצ׳ מופיע פעמיים (גם בשורה ${first})`, f);
        continue;
      }
      seen.set(serial, r.row);
      const res = this.person(cell(r, 3), cell(r, 4));
      if ("error" in res) {
        this.error("assignments", r.row, res.error, f);
        continue;
      }
      const { person } = res;
      const notes = cell(r, 7) || null;
      const kit = parseKitText(cell(r, 8));
      const app = this.st.serialsBySerial.get(serial);
      const open = app ? this.st.openAssignments.get(app.id) : undefined;
      const lf = { key: serial, item: app ? this.itemName(app.itemId) : itemName || null, serial, personName: person.fullName };

      if (!open) {
        const needs = this.serialFor(serial, itemName, { sheet: "assignments", row: r.row }, f);
        if ("error" in needs) {
          this.error("assignments", r.row, needs.error, f);
          continue;
        }
        this.push("assignments", r.row, "new", { t: "assignment.add", serial, personId: person.id, notes, kit }, {
          ...lf,
          after: person.fullName,
          dependsOn: needs.dependsOn,
        });
      } else if (open.personId !== person.id) {
        const op: ChangeOp = { t: "assignment.transfer", assignmentId: open.id, serial, personId: person.id, notes, kit };
        this.push("assignments", r.row, "change", op, { ...lf, before: this.holderName(open.personId), after: person.fullName });
      } else if (kitToString(cleanKit(open.kit)) !== kitToString(kit)) {
        this.push("assignments", r.row, "change", { t: "assignment.kit", assignmentId: open.id, kit }, {
          ...lf,
          before: kitToString(cleanKit(open.kit)),
          after: kitToString(kit),
        });
      } else this.same("assignments");
    }

    for (const open of this.st.openAssignments.values()) {
      const s = this.st.serialsById.get(open.serialId);
      if (!s || seen.has(s.serial)) continue;
      const holder = this.holderName(open.personId);
      this.push("assignments", null, "appOnly", { t: "assignment.return", assignmentId: open.id }, {
        key: s.serial,
        item: this.itemName(s.itemId),
        serial: s.serial,
        personName: holder,
        before: holder,
      });
    }
  }

  private holderName(personId: string): string {
    return this.st.peopleById.get(personId)?.fullName ?? "חייל אחר";
  }

  /** 'אפסון': company, name, personal number, item, serial, in date, out date (filled = released). */
  storage(rows: readonly SheetRow[]) {
    // Rows match on soldier + צ׳ + item + Israel day (app rows carry a time of day, the sheet
    // usually doesn't). Identical rows (two magazines stored the same day) are told apart by
    // their order: the n-th sheet row matches the n-th app row.
    const sheetCount = new Map<string, number>();
    const parsed: StorageRow[] = [];
    for (const r of rows) {
      const rec = this.storageRow(r);
      if (!rec) continue;
      const n = (sheetCount.get(rec.key) ?? 0) + 1;
      sheetCount.set(rec.key, n);
      parsed.push({ ...rec, key: `${rec.key}#${n}` });
    }

    const appCount = new Map<string, number>();
    const appByKey = new Map<string, StorageRef>();
    const appKey = new Map<string, string>(); // storage id → key
    const byTime = [...this.st.storage].sort((a, b) => a.storedAt.getTime() - b.storedAt.getTime() || (a.id < b.id ? -1 : 1));
    for (const s of byTime) {
      const serial = s.serialId ? (this.st.serialsById.get(s.serialId)?.serial ?? "") : "";
      const base = storageKey(s.personId, serial, s.itemName, s.storedAt);
      const n = (appCount.get(base) ?? 0) + 1;
      appCount.set(base, n);
      appByKey.set(`${base}#${n}`, s);
      appKey.set(s.id, `${base}#${n}`);
    }
    const matched = new Set<string>();
    /** serial → what keeps it in storage: an app row (and the line releasing it, if any) or an earlier sheet row */
    const openBySerial = new Map<string, { releasedBy: string | null }>();
    for (const s of this.st.storage) {
      const serial = s.serialId ? this.st.serialsById.get(s.serialId)?.serial : undefined;
      if (serial && !s.releasedAt) openBySerial.set(serial, { releasedBy: null });
    }

    // rows the app already has
    for (const rec of parsed) {
      const app = appByKey.get(rec.key);
      if (!app) continue;
      matched.add(app.id);
      const lf = { key: rec.key, ...rec.f, personName: rec.person.fullName };
      if (!app.releasedAt) {
        if (!rec.releasedAt) {
          this.same("storage");
          continue;
        }
        const id = this.push("storage", rec.row, "change", { t: "storage.release", storageId: app.id, releasedAt: rec.releasedAt.toISOString() }, {
          ...lf,
          before: "באפסון",
          after: `שוחרר ${fmtDate(rec.releasedAt)}`,
        });
        if (rec.serial) openBySerial.set(rec.serial, { releasedBy: id });
      } else if (!rec.releasedAt) {
        this.error("storage", rec.row, "שוחרר באפליקציה – לא ניתן להחזיר לאפסון", rec.f);
      } else if (sheetDay(app.releasedAt) !== sheetDay(rec.releasedAt)) {
        this.push("storage", rec.row, "change", { t: "storage.release", storageId: app.id, releasedAt: rec.releasedAt.toISOString() }, {
          ...lf,
          before: `שוחרר ${fmtDate(app.releasedAt)}`,
          after: `שוחרר ${fmtDate(rec.releasedAt)}`,
        });
      } else this.same("storage");
    }

    // rows the app doesn't have
    for (const rec of parsed) {
      if (appByKey.has(rec.key)) continue;
      const dependsOn = [...rec.dependsOn];
      if (rec.serial && !rec.releasedAt) {
        const holder = openBySerial.get(rec.serial);
        if (holder && !holder.releasedBy) {
          this.error("storage", rec.row, `צ׳ ${rec.serial} כבר באפסון`, rec.f);
          continue;
        }
        if (holder?.releasedBy) dependsOn.push(holder.releasedBy);
        openBySerial.set(rec.serial, { releasedBy: null });
      }
      const op: ChangeOp = {
        t: "storage.add",
        personId: rec.person.id,
        serial: rec.serial || null,
        itemName: rec.itemName,
        storedAt: rec.storedAt.toISOString(),
        releasedAt: rec.releasedAt?.toISOString() ?? null,
      };
      this.push("storage", rec.row, "new", op, {
        key: rec.key,
        ...rec.f,
        personName: rec.person.fullName,
        after: rec.releasedAt ? `שוחרר ${fmtDate(rec.releasedAt)}` : `באפסון מ-${fmtDate(rec.storedAt)}`,
        dependsOn,
      });
    }

    for (const s of this.st.storage) {
      if (s.releasedAt || matched.has(s.id)) continue;
      const serial = s.serialId ? (this.st.serialsById.get(s.serialId)?.serial ?? null) : null;
      this.push("storage", null, "appOnly", { t: "storage.release", storageId: s.id, releasedAt: new Date().toISOString() }, {
        key: appKey.get(s.id)!,
        item: s.itemName,
        serial,
        personName: this.holderName(s.personId),
        before: `באפסון מ-${fmtDate(s.storedAt)}`,
      });
    }
  }

  /** One אפסון row, validated; an error line (and undefined) when it can't be read. */
  private storageRow(r: SheetRow): StorageRow | undefined {
    const raw = normalizeSerial(cell(r, 5));
    const serial = raw === "0" ? "" : raw; // '0' marked an item without a serial
    const ref = serial ? this.st.serialsBySerial.get(serial) : undefined;
    const planned = serial && !ref ? this.plannedSerials.get(serial) : undefined;
    const itemName = cell(r, 4) || (ref ? this.itemName(ref.itemId) : planned?.itemName) || "";
    const f = { item: itemName || null, serial: serial || null, personName: nameKey(cell(r, 2)) || null };
    const fail = (message: string) => void this.error("storage", r.row, message, f);
    if (serial && !ref && !planned) return fail(`צ׳ ${serial} לא קיים בטבלת צ`);
    if (!itemName) return fail("חסר פריט");
    const storedAt = parseSheetDate(cell(r, 6));
    if (!storedAt) return fail(cell(r, 6) ? `תאריך אפסון לא תקין "${cell(r, 6)}"` : "חסר תאריך אפסון");
    const out = cell(r, 7);
    const releasedAt = out ? parseSheetDate(out) : null;
    if (releasedAt === undefined) return fail(`תאריך הוצאה לא תקין "${out}"`);
    const res = this.person(cell(r, 2), cell(r, 3));
    if ("error" in res) return fail(res.error);
    return {
      row: r.row,
      key: storageKey(res.person.id, serial, itemName, storedAt),
      person: res.person,
      serial,
      itemName,
      storedAt,
      releasedAt,
      dependsOn: planned ? [planned.lineId] : [],
      f,
    };
  }
}

interface StorageRow {
  row: number;
  key: string;
  person: PersonRef;
  /** "" = no serial */
  serial: string;
  itemName: string;
  storedAt: Date;
  releasedAt: Date | null;
  dependsOn: string[];
  f: ErrorFields;
}

function storageKey(personId: string, serial: string, itemName: string, storedAt: Date): string {
  return `${personId}|${serial}|${itemName}|${sheetDay(storedAt)}`;
}

const fmtDate = formatSheetDate;

/** sha256 over what the preview showed: changes when the app (or the file) changes the lines. */
function fingerprint(lines: readonly ChangeLine[]): string {
  const shown = [...lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => [l.id, l.before, l.after, l.message]);
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
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
  if (chosen("serials")) {
    const inOtherTabs = new Set([
      ...(chosen("assignments") ? sheets.assignments!.map((r) => normalizeSerial(cell(r, 6))) : []),
      ...(chosen("storage") ? sheets.storage!.map((r) => normalizeSerial(cell(r, 5))) : []),
    ]);
    d.serials(sheets.serials!, inOtherTabs);
  }
  if (chosen("kit")) d.kit(sheets.kit!);
  if (chosen("assignments")) d.assignments(sheets.assignments!);
  if (chosen("storage")) d.storage(sheets.storage!);
  return { lines: d.lines, identical: d.identical, fingerprint: fingerprint(d.lines) };
}
