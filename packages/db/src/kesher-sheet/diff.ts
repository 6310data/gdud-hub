/**
 * Sheet + app state → the change lines the preview shows. Reads the database (through the
 * caller's transaction, so RLS applies) and writes nothing.
 *
 * Soldiers are never created or edited here (דוח 1 owns them) and units never created. A name
 * matches only an exact, unique full name among the active soldiers of the row's company; anything
 * else is an error line, and the צ׳ itself still imports — only its holder stays empty.
 */
import { createHash } from "node:crypto";
import { KESHER_WAREHOUSE, kesherLogKind, normalizeSerial, searchKey, type KesherLocation } from "@gdud/core";
import type { Tx } from "../index";
import { formatSheetDate, parseSheetDate, sheetDay } from "../logistics-sheet/sheet";
import { fingerprintLines } from "../sheet-import/index";
import type { LineGroup, PickChoice } from "../sheet-import/preview";
import { MSG } from "./preview";
import { cell, nameKey, type KesherSheetKey, type KesherSheets, type KesherTab, type SheetRow } from "./sheet";
import { loadState, personKey, stockKey, type CompanyRef, type State } from "./state";
import type { ChangeLine, ChangeOp, CheckLineRow, CheckRow, LineKind, LogEventRow, SheetDiff, SignerRef } from "./types";

export const ITEM_NAME_MAX = 80;
const TEXT_MAX = 40;
const SERIAL_FORMAT = /^[^\s]{1,40}$/;
const WAREHOUSE_KEY = searchKey(KESHER_WAREHOUSE);

type Place = { location: "warehouse" | "none"; unit: null } | { location: "company"; unit: CompanyRef };
type Pick = NonNullable<ChangeLine["pick"]>;
type Soldier = { id: string | null; pick?: Pick } | { error: string; label: string; pick?: Pick };

interface LineFields {
  key: string;
  item?: string | null;
  serial?: string | null;
  personName?: string | null;
  before?: string | null;
  after?: string | null;
  message?: string | null;
  dependsOn?: string[];
  pick?: Pick;
}

const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const nullIfBlank = (s: string) => s || null;
/** "" → 0; whole numbers only (a cell like 12.5 is NaN). */
const parseQty = (s: string) => (s === "" ? 0 : /^-?\d+$/.test(s) ? Number(s) : Number.NaN);
const placeText = (p: Place) => (p.location === "company" ? p.unit.name : p.location === "warehouse" ? "במחסן" : "ללא שיוך");
const joinText = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

class Differ {
  readonly lines: ChangeLine[] = [];
  readonly identical: Partial<Record<KesherSheetKey, number>> = {};
  /** item name → the line that creates it in this diff, and its kind */
  private readonly plannedItems = new Map<string, { lineId: string; kind: "serial" | "bulk" }>();
  /** serial → where פיזור צ כללי puts it, and the line that creates or moves it (null = no move) */
  private readonly sheetPlace = new Map<string, { unitId: string | null; name: string; lineId: string | null }>();

  constructor(
    private readonly st: State,
    private readonly picks: ReadonlyMap<string, string>,
  ) {}

  /* ── line builders ── */

  private push(sheet: KesherSheetKey, row: number | null, group: LineGroup, op: ChangeOp, f: LineFields): string {
    const id = `${sheet}:${op.t}:${f.key}`;
    this.lines.push({
      ...this.fields(sheet, row, group, op.t, f),
      id,
      selectable: true,
      defaultOn: group !== "appOnly",
      dependsOn: f.dependsOn ?? [],
      op,
    });
    return id;
  }

  /** A line that only informs: a warning, or an app-only row the import won't touch. */
  private info(sheet: KesherSheetKey, row: number | null, group: LineGroup, f: LineFields) {
    this.lines.push({ ...this.fields(sheet, row, group, "info", f), id: `${sheet}:info:${f.key}`, selectable: false, defaultOn: false, dependsOn: [], op: null });
  }

  private error(sheet: KesherSheetKey, row: number | null, message: string, f: Omit<LineFields, "message">) {
    this.lines.push({
      ...this.fields(sheet, row, "error", "error", { ...f, message }),
      id: `${sheet}:error:${f.key}`,
      selectable: false,
      defaultOn: false,
      dependsOn: [],
      op: null,
    });
  }

  private fields(sheet: KesherSheetKey, row: number | null, group: LineGroup, kind: LineKind, f: LineFields) {
    return {
      sheet,
      row,
      group,
      kind,
      item: f.item ?? null,
      serial: f.serial ?? null,
      personName: f.personName ?? null,
      before: f.before ?? null,
      after: f.after ?? null,
      message: f.message ?? null,
      ...(f.pick ? { pick: f.pick } : {}),
    };
  }

  private same(sheet: KesherSheetKey) {
    this.identical[sheet] = (this.identical[sheet] ?? 0) + 1;
  }

  /* ── lookups ── */

  /** במחסן → warehouse, blank → none, else a company that exists. */
  private place(text: string): Place | { error: string } {
    const k = searchKey(text);
    if (!k) return { location: "none", unit: null };
    if (k === WAREHOUSE_KEY) return { location: "warehouse", unit: null };
    const unit = this.st.companiesByKey.get(k);
    return unit ? { location: "company", unit } : { error: MSG.noCompany(nameKey(text)) };
  }

  /** Exact, unique full name among the company's active soldiers; an ambiguous name may be picked. */
  private soldier(company: CompanyRef, name: string): Soldier {
    const n = nameKey(name);
    if (!n) return { id: null };
    const key = personKey(company.id, n);
    const found = this.st.peopleByName.get(key) ?? [];
    const label = `${n} (${company.name})`;
    if (found.length === 1) return { id: found[0]!.id };
    if (!found.length) return { error: MSG.noSoldier, label };
    const choices: PickChoice[] = found.map((p) => ({ id: p.id, label: joinText(p.fullName, p.place) }));
    const wanted = this.picks.get(key);
    const chosen = wanted && choices.some((c) => c.id === wanted) ? wanted : null;
    const pick: Pick = { key, choices, chosen };
    if (chosen) return { id: chosen, pick };
    return { error: `יש ${found.length} חיילים בשם "${n}" ב${company.name} — בחרו את החייל`, label, pick };
  }

  private personName(id: string | null | undefined): string | null {
    return id ? (this.st.peopleById.get(id)?.fullName ?? "—") : null;
  }

  /** The item a new row needs: in the app, created earlier in this diff, or created now. */
  private needItem(
    name: string,
    kind: "serial" | "bulk",
    at: { sheet: KesherSheetKey; row: number },
    extra: { category?: string | null; brigadeQty?: number | null } = {},
  ): { dependsOn: string[] } | { error: string } {
    const existing = this.st.itemsByName.get(name);
    const planned = this.plannedItems.get(name);
    const k = existing?.kind ?? planned?.kind;
    if (k && k !== kind) return { error: kind === "serial" ? `"${name}" רשום כציוד משלים ולא כסוג מכשיר` : `"${name}" רשום כסוג מכשיר ולא כציוד משלים` };
    if (existing) return { dependsOn: [] };
    if (planned) return { dependsOn: [planned.lineId] };
    if (name.length > ITEM_NAME_MAX) return { error: `שם פריט ארוך מדי (${name.length} תווים, מקסימום ${ITEM_NAME_MAX})` };
    const op: ChangeOp = { t: "item.add", name, kind, category: extra.category ?? null, brigadeQty: extra.brigadeQty ?? null };
    const lineId = this.push(at.sheet, at.row, "new", op, {
      key: name,
      item: name,
      after: kind === "serial" ? "סוג מכשיר חדש" : "ציוד משלים חדש",
    });
    this.plannedItems.set(name, { lineId, kind });
    return { dependsOn: [lineId] };
  }

  /* ── פיזור צ כללי: A סוג מכשיר · B צ׳ · E פלוגה · F תפקיד · G מי חתום · J הערות · K האמר ── */

  pizur(tab: KesherTab) {
    const seen = new Map<string, number>();
    for (const r of tab.rows) {
      const type = nameKey(cell(r, 1));
      const serial = normalizeSerial(cell(r, 2));
      if (!type && !serial) continue;
      const at = { item: type || null, serial: serial || null };
      if (!serial) {
        this.error("pizur", r.row, "חסר צ׳", { key: `${r.row}`, ...at });
        continue;
      }
      if (!SERIAL_FORMAT.test(serial)) {
        this.error("pizur", r.row, "צ׳ לא תקין (רווחים או יותר מ־40 תווים)", { key: `${r.row}`, ...at });
        continue;
      }
      const first = seen.get(serial);
      if (first) {
        this.error("pizur", r.row, `הצ׳ מופיע פעמיים (גם בשורה ${first})`, { key: `${r.row}`, ...at });
        continue;
      }
      seen.set(serial, r.row);
      if (!type) {
        this.error("pizur", r.row, "חסר סוג מכשיר", { key: `${r.row}`, ...at });
        continue;
      }
      const place = this.place(cell(r, 5));
      if ("error" in place) {
        this.error("pizur", r.row, place.error, { key: `${r.row}`, ...at });
        continue;
      }
      const vehicle = nullIfBlank(cell(r, 11));
      const notes = nullIfBlank(cell(r, 10));
      const signerRole = nullIfBlank(cell(r, 6));
      if ((vehicle?.length ?? 0) > TEXT_MAX || (signerRole?.length ?? 0) > TEXT_MAX || (notes?.length ?? 0) > 500) {
        this.error("pizur", r.row, "טקסט ארוך מדי (תפקיד / האמר עד 40 תווים, הערה עד 500)", { key: `${r.row}`, ...at });
        continue;
      }
      const existing = this.st.serialsBySerial.get(serial);
      const item = this.st.itemsByName.get(type);
      if (existing && existing.itemId !== item?.id) {
        this.error("pizur", r.row, MSG.itemDiffers, { key: `${r.row}`, ...at, before: this.st.itemsById.get(existing.itemId)?.name, after: type });
        continue;
      }
      const needs = this.needItem(type, "serial", { sheet: "pizur", row: r.row });
      if ("error" in needs) {
        this.error("pizur", r.row, needs.error, { key: `${r.row}`, ...at });
        continue;
      }

      // who signed for it (only when it is on a company); an unmatched name is its own error line
      let signer: SignerRef | null = null;
      let pick: Pick | undefined;
      if (place.location === "company") {
        const s = this.soldier(place.unit, cell(r, 7));
        pick = s.pick;
        if ("error" in s) {
          this.error("pizur", r.row, s.error, { key: `${serial}:signer`, ...at, personName: s.label, pick: s.pick });
          signer = { personId: null, role: signerRole };
        } else signer = { personId: s.id, role: signerRole };
      }
      const unitId = place.unit?.id ?? null;

      if (!existing) {
        const lineId = this.push(
          "pizur",
          r.row,
          "new",
          { t: "serial.add", serial, itemName: type, location: place.location, unitId, vehicle, notes, signer },
          {
            key: serial,
            ...at,
            personName: this.personName(signer?.personId),
            after: joinText(placeText(place), signer?.role, vehicle ? `האמר ${vehicle}` : null),
            dependsOn: needs.dependsOn,
            pick,
          },
        );
        this.sheetPlace.set(serial, { unitId, name: placeText(place), lineId });
        continue;
      }

      const appPlace: Place =
        existing.location === "company" && existing.unitId
          ? { location: "company", unit: this.st.companiesById.get(existing.unitId) ?? { id: existing.unitId, name: "—" } }
          : { location: existing.location as "warehouse" | "none", unit: null };
      const moved = existing.location !== place.location || existing.unitId !== unitId;
      const detailsDiffer = existing.vehicle !== vehicle || existing.notes !== notes;
      let lineId: string | null = null;
      if (moved || detailsDiffer) {
        const describe = (p: Place, v: string | null, n: string | null) => joinText(placeText(p), v ? `האמר ${v}` : null, n ? `הערה: ${n}` : null);
        lineId = this.push(
          "pizur",
          r.row,
          "change",
          { t: "serial.update", serialId: existing.id, location: place.location, unitId, vehicle, notes, signer: moved ? signer : null },
          {
            key: serial,
            ...at,
            personName: moved ? this.personName(signer?.personId) : null,
            before: describe(appPlace, existing.vehicle, existing.notes),
            after: describe(place, vehicle, notes),
            message: moved && existing.location === "company" ? "הצ׳ עובר מפלוגה — השיוך הקודם בפלוגה יימחק" : null,
            pick: moved ? pick : undefined,
          },
        );
      } else this.same("pizur");
      this.sheetPlace.set(serial, { unitId, name: placeText(place), lineId: moved ? lineId : null });

      // same company: compare who signed
      if (!moved && place.location === "company" && signer && !(pick && !pick.chosen)) {
        const h = this.st.holders.get(existing.id);
        const unmatched = signer.personId === null && nameKey(cell(r, 7)) !== "";
        if (unmatched) continue;
        if ((h?.signerPersonId ?? null) !== signer.personId || (h?.signerRole ?? null) !== signer.role) {
          this.push(
            "pizur",
            r.row,
            h?.signerPersonId || h?.signerRole ? "change" : "new",
            { t: "signer.set", serial, personId: signer.personId, role: signer.role },
            {
              key: serial,
              ...at,
              personName: this.personName(signer.personId),
              before: h ? joinText(this.personName(h.signerPersonId), h.signerRole) : null,
              after: joinText(this.personName(signer.personId), signer.role),
              pick,
            },
          );
        }
      }
    }

    // in the app, not in the sheet: removable only when not on a company
    for (const s of this.st.serialsBySerial.values()) {
      if (seen.has(s.serial)) continue;
      const item = this.st.itemsById.get(s.itemId)?.name ?? null;
      if (s.location === "company") {
        const company = this.st.companiesById.get(s.unitId ?? "")?.name ?? "פלוגה";
        this.info("pizur", null, "appOnly", { key: s.serial, item, serial: s.serial, message: `רשום על ${company} — לא יוסר` });
      } else {
        this.push("pizur", null, "appOnly", { t: "serial.delete", serialId: s.id }, { key: s.serial, item, serial: s.serial, before: s.location === "warehouse" ? "במחסן" : "ללא שיוך" });
      }
    }
  }

  /* ── company tabs: F צ׳ · G חתום · H תפקיד · I מסגרת ── */

  companies(tabs: readonly KesherTab[]) {
    for (const tab of tabs) {
      const company = this.st.companiesByKey.get(searchKey(tab.name));
      if (!company) {
        if (tab.rows.length) {
          this.error("companies", tab.rows[0]!.row, `${MSG.noCompany(nameKey(tab.name))} (${tab.rows.length} שורות בגיליון)`, { key: `tab:${tab.name}` });
        }
        continue;
      }
      const seen = new Map<string, number>();
      for (const r of tab.rows) {
        const serial = normalizeSerial(cell(r, 6));
        if (!serial) continue;
        const key = `${tab.name}:${serial}`;
        const first = seen.get(serial);
        if (first) {
          this.error("companies", r.row, `הצ׳ מופיע פעמיים בגיליון ${tab.name} (גם בשורה ${first})`, { key: `${key}:${r.row}`, serial });
          continue;
        }
        seen.set(serial, r.row);
        const appSerial = this.st.serialsBySerial.get(serial);
        const item = appSerial ? (this.st.itemsById.get(appSerial.itemId)?.name ?? null) : nullIfBlank(cell(r, 5));
        const planned = this.sheetPlace.get(serial);
        const place = planned ?? (appSerial ? { unitId: appSerial.unitId, name: this.st.companiesById.get(appSerial.unitId ?? "")?.name ?? placeText({ location: appSerial.location as "warehouse", unit: null }), lineId: null } : undefined);
        if (!place) {
          this.error("companies", r.row, `הצ׳ לא קיים ב"פיזור צ כללי" ולא באפליקציה (גיליון ${tab.name})`, { key, serial, item });
          continue;
        }
        if (place.unitId !== company.id) {
          this.error("companies", r.row, `הצ׳ רשום על ${place.name} ולא על ${company.name}`, { key, serial, item });
          continue;
        }
        const role = nullIfBlank(cell(r, 8));
        const frame = nullIfBlank(cell(r, 9));
        if ((role?.length ?? 0) > TEXT_MAX || (frame?.length ?? 0) > TEXT_MAX) {
          this.error("companies", r.row, "תפקיד / מסגרת ארוכים מדי (עד 40 תווים)", { key, serial, item });
          continue;
        }
        const s = this.soldier(company, cell(r, 7));
        if ("error" in s) {
          this.error("companies", r.row, s.error, { key, serial, item, personName: s.label, pick: s.pick });
          continue;
        }
        // a צ׳ that moves to this company in this import has no holder yet
        const h = place.lineId || !appSerial ? undefined : this.st.holders.get(appSerial.id);
        const now = { personId: h?.holderPersonId ?? null, role: h?.holderRole ?? null, frame: h?.frame ?? null };
        if (now.personId === s.id && now.role === role && now.frame === frame) {
          this.same("companies");
          continue;
        }
        this.push(
          "companies",
          r.row,
          now.personId || now.role || now.frame ? "change" : "new",
          { t: "holder.set", serial, personId: s.id, role, frame },
          {
            key,
            serial,
            item,
            personName: this.personName(s.id),
            before: now.personId || now.role || now.frame ? joinText(this.personName(now.personId) ?? "ללא חותם", now.role, now.frame) : null,
            after: joinText(this.personName(s.id) ?? "ללא חותם", role, frame),
            message: `גיליון ${tab.name}`,
            dependsOn: place.lineId ? [place.lineId] : [],
            pick: s.pick,
          },
        );
      }
    }
  }

  /* ── כללי: C פריט · columns by header: במחסן, each company, מלאי כללי, מלאי קבלות חטיבה ── */

  general(tab: KesherTab) {
    const cols: { col: number; unitId: string | null; name: string }[] = [];
    let totalCol = 0;
    let brigadeCol = 0;
    // A–C are category / item; P onward are helper blocks
    for (let i = 3; i < Math.min(tab.header.length, 15); i++) {
      const h = nameKey(tab.header[i] ?? "");
      const k = searchKey(h);
      if (!k) continue;
      if (k === WAREHOUSE_KEY) cols.push({ col: i + 1, unitId: null, name: KESHER_WAREHOUSE });
      else if (k.includes("חטיבה")) brigadeCol = i + 1;
      else if (k === searchKey("מלאי כללי")) totalCol = i + 1;
      else {
        const unit = this.st.companiesByKey.get(k);
        if (unit) cols.push({ col: i + 1, unitId: unit.id, name: unit.name });
        else this.error("general", 2, `${MSG.noCompany(h)} — הכמויות בעמודה הזו לא ייובאו`, { key: `col:${h}` });
      }
    }
    if (!cols.length) {
      this.error("general", 2, "לא נמצאו בשורה 2 עמודות \"במחסן\" או של פלוגות", { key: "header" });
      return;
    }
    const seen = new Map<string, number>();
    for (const r of tab.rows) {
      const name = nameKey(cell(r, 3));
      if (!name) continue;
      const first = seen.get(name);
      if (first) {
        this.error("general", r.row, `הפריט מופיע פעמיים (גם בשורה ${first})`, { key: `${r.row}`, item: name });
        continue;
      }
      seen.set(name, r.row);
      const qtys = cols.map((c) => ({ ...c, qty: parseQty(cell(r, c.col)) }));
      const bad = qtys.find((q) => Number.isNaN(q.qty) || (q.qty < 0 && (q.unitId !== null || this.st.warehouseTracked)));
      if (bad) {
        this.error("general", r.row, `כמות לא תקינה בעמודה ${bad.name}: "${cell(r, bad.col)}"`, { key: `${r.row}`, item: name });
        continue;
      }
      const brigade = brigadeCol ? parseQty(cell(r, brigadeCol)) : undefined;
      if (brigade !== undefined && (Number.isNaN(brigade) || brigade < 0)) {
        this.error("general", r.row, `מלאי קבלות חטיבה לא תקין: "${cell(r, brigadeCol)}"`, { key: `${r.row}`, item: name });
        continue;
      }
      const brigadeQty = brigade === undefined ? undefined : cell(r, brigadeCol) === "" ? null : brigade;
      const existing = this.st.itemsByName.get(name);
      const needs = this.needItem(name, "bulk", { sheet: "general", row: r.row }, { category: nullIfBlank(cell(r, 1)), brigadeQty: brigadeQty ?? null });
      if ("error" in needs) {
        this.error("general", r.row, needs.error, { key: `${r.row}`, item: name });
        continue;
      }
      let changed = false;
      if (existing && brigadeQty !== undefined && existing.brigadeQty !== brigadeQty) {
        changed = true;
        this.push("general", r.row, "change", { t: "item.brigade", itemId: existing.id, brigadeQty }, {
          key: name,
          item: name,
          before: `מלאי חטיבה ${existing.brigadeQty ?? "—"}`,
          after: `מלאי חטיבה ${brigadeQty ?? "—"}`,
        });
      }
      const sum = qtys.reduce((n, q) => n + q.qty, 0);
      const total = totalCol ? parseQty(cell(r, totalCol)) : Number.NaN;
      const warning = !Number.isNaN(total) && cell(r, totalCol) !== "" && total !== sum ? `"מלאי כללי" בגיליון ${total}, סכום העמודות ${sum}` : null;
      const app = (unitId: string | null) => (existing ? (this.st.stock.get(stockKey(existing.id, unitId)) ?? 0) : 0);
      const diff = qtys.filter((q) => app(q.unitId) !== q.qty);
      if (diff.length) {
        changed = true;
        this.push("general", r.row, existing ? "change" : "new", { t: "stock.set", itemName: name, cells: diff.map((q) => ({ unitId: q.unitId, qty: q.qty })) }, {
          key: name,
          item: name,
          before: existing ? diff.map((q) => `${q.name} ${app(q.unitId)}`).join(" · ") : null,
          after: diff.map((q) => `${q.name} ${q.qty}`).join(" · "),
          message: warning,
          dependsOn: needs.dependsOn,
        });
      } else if (warning) {
        this.info("general", r.row, "change", { key: name, item: name, message: warning });
      }
      if (!changed && !needs.dependsOn.length) this.same("general");
    }
  }

  /* ── תקן ציוד משלים: B פריט אב · C ציוד משלים · D כמות ליחידה ── */

  kit(tab: KesherTab) {
    const itemKind = (name: string) => this.st.itemsByName.get(name)?.kind ?? this.plannedItems.get(name)?.kind;
    const needs = (name: string) => {
      const planned = this.plannedItems.get(name);
      return !this.st.itemsByName.has(name) && planned ? [planned.lineId] : [];
    };
    const rows: { row: number; parent: string; child: string; qty: number; order: number }[] = [];
    const seen = new Map<string, number>();
    for (const r of tab.rows) {
      const parent = nameKey(cell(r, 2));
      const child = nameKey(cell(r, 3));
      if (!parent && !child) continue;
      const f = { key: `${r.row}`, item: joinText(parent, child) };
      if (!parent || !child) {
        this.error("kit", r.row, "חסר פריט אב או ציוד משלים", f);
        continue;
      }
      if (!itemKind(parent)) {
        this.error("kit", r.row, `פריט האב "${parent}" לא קיים — לא סוג מכשיר ולא ציוד משלים`, f);
        continue;
      }
      if (itemKind(child) !== "bulk") {
        this.error("kit", r.row, `"${child}" אינו ציוד משלים`, f);
        continue;
      }
      const q = cell(r, 4);
      const qty = /^\d+$/.test(q) ? Number(q) : Number.NaN;
      if (!(qty >= 1 && qty <= 99)) {
        this.error("kit", r.row, `כמות ליחידה לא תקינה: "${q}" (1–99)`, f);
        continue;
      }
      if (parent === child) {
        this.error("kit", r.row, "פריט לא יכול להיות בתקן של עצמו", f);
        continue;
      }
      const key = `${parent}|${child}`;
      const first = seen.get(key);
      if (first) {
        this.error("kit", r.row, `השורה מופיעה פעמיים (גם בשורה ${first})`, f);
        continue;
      }
      seen.set(key, r.row);
      rows.push({ row: r.row, parent, child, qty, order: rows.length });
    }

    // the תקן must not loop: the app's lines, then the sheet's in row order (a line that would close a loop is an error)
    const idName = (id: string) => this.st.itemsById.get(id)?.name ?? "";
    const edges = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => edges.set(a, (edges.get(a) ?? new Set()).add(b));
    for (const k of this.st.kits) addEdge(idName(k.parentItemId), idName(k.itemId));
    const reaches = (from: string, to: string) => {
      const stack = [from];
      const visited = new Set<string>();
      while (stack.length) {
        const n = stack.pop()!;
        if (n === to) return true;
        if (visited.has(n)) continue;
        visited.add(n);
        stack.push(...(edges.get(n) ?? []));
      }
      return false;
    };

    const appKit = new Map(this.st.kits.map((k) => [`${idName(k.parentItemId)}|${idName(k.itemId)}`, k]));
    for (const r of rows) {
      const key = `${r.parent}|${r.child}`;
      const f = { key, item: `${r.parent} ← ${r.child}` };
      const app = appKit.get(key);
      if (!app) {
        if (reaches(r.child, r.parent)) {
          this.error("kit", r.row, "תקן מעגלי — הפריט כבר כלול (בשרשור) בתקן של הציוד המשלים שלו", { key: `${r.row}`, item: f.item });
          continue;
        }
        addEdge(r.parent, r.child);
      }
      if (!app) {
        this.push("kit", r.row, "new", { t: "kit.add", parentName: r.parent, childName: r.child, qty: r.qty, sortOrder: r.order }, { ...f, after: `×${r.qty}`, dependsOn: [...needs(r.parent), ...needs(r.child)] });
      } else if (app.qty !== r.qty) {
        this.push("kit", r.row, "change", { t: "kit.qty", kitId: app.id, qty: r.qty }, { ...f, before: `×${app.qty}`, after: `×${r.qty}` });
      } else this.same("kit");
    }
    for (const [key, k] of appKit) {
      if (seen.has(key)) continue;
      this.push("kit", null, "appOnly", { t: "kit.remove", kitId: k.id }, { key, item: `${idName(k.parentItemId)} ← ${idName(k.itemId)}`, before: `×${k.qty}` });
    }
  }

  /** One error line per company the app doesn't have, with the rows it covers. */
  private unknownCompanies(sheet: KesherSheetKey, rows: Map<string, number[]>, what: string) {
    for (const [name, list] of rows) {
      this.error(sheet, list[0]!, `${MSG.noCompany(name)} — ${list.length} ${what} לא ייובאו`, { key: `company:${name}` });
    }
  }

  /* ── יומן חתימות: A זמן · B פלוגה · C חייל · D תפקיד · E מחתים · F פעולה · G סוג רשומה · H פריט · I צ׳ · J כמות (K, emails: never read) ── */

  log(tab: KesherTab) {
    const seen = new Map<string, number>();
    const events: LogEventRow[] = [];
    const used: number[] = [];
    const unknown = new Map<string, number[]>();
    let onlyTime = 0;
    for (const r of tab.rows) {
      const cells = Array.from({ length: 10 }, (_, i) => cell(r, i + 1));
      if (cells.slice(1).every((c) => !c)) {
        onlyTime++;
        continue;
      }
      const content = JSON.stringify(cells);
      const occurrence = seen.get(content) ?? 0;
      seen.set(content, occurrence + 1);
      const sheetKey = hash(["kesher-log", ...cells, occurrence]);
      if (this.st.logKeys.has(sheetKey)) {
        this.same("log");
        continue;
      }
      const at = parseSheetDate(cells[0]!);
      if (!at) {
        this.error("log", r.row, cells[0] ? `תאריך לא תקין "${cells[0]}"` : "חסר תאריך", { key: `${r.row}` });
        continue;
      }
      const place = this.place(cells[1]!);
      if ("error" in place) {
        const name = nameKey(cells[1]!);
        unknown.set(name, [...(unknown.get(name) ?? []), r.row]);
        continue;
      }
      const name = nameKey(cells[2]!);
      const s = place.unit && name ? this.soldier(place.unit, name) : null;
      const { kind, backdated } = kesherLogKind(cells[5]!);
      const qty = /^\d+$/.test(cells[9]!) ? Number(cells[9]) : null;
      events.push({
        at: at.toISOString(),
        kind,
        backdated,
        unitId: place.unit?.id ?? null,
        company: place.unit?.name ?? (place.location === "warehouse" ? KESHER_WAREHOUSE : null),
        personId: s && !("error" in s) ? s.id : null,
        personName: name || null,
        personRole: nullIfBlank(cells[3]!),
        item: nullIfBlank(cells[7]!),
        serial: normalizeSerial(cells[8]) || null,
        qty,
        details: kind === "legacy" ? nullIfBlank(nameKey(cells[5]!)) : null,
        sheetActor: nullIfBlank(cells[4]!),
        sheetKey,
      });
      used.push(r.row);
    }
    this.unknownCompanies("log", unknown, "שורות ביומן");
    if (!events.length) return;
    const times = events.map((e) => e.at).sort();
    this.push("log", used[0]!, "new", { t: "log.add", events }, {
      key: hash(events.map((e) => e.sheetKey)).slice(0, 16),
      after: `${events.length} רישומים · ${formatSheetDate(new Date(times[0]!))} – ${formatSheetDate(new Date(times.at(-1)!))}`,
      message: joinText(`שורות ${used[0]}–${used.at(-1)} בגיליון. נשמרים ביומן כפי שהם.`, onlyTime ? `${onlyTime} שורות עם תאריך בלבד דולגו` : null),
    });
  }

  /*
   * דוחות צ׳: A זמן · B פלוגה · C מדווח · E סה״כ · F נבדקו · H פירוט הלא־נמצאו · I הערות (D email, J status: never read)
   * בדיקות צ׳: A צ׳ · B סוג מכשיר · C פלוגה · D תאריך · E נבדק ע״י · F סטטוס
   * A check row goes with the report of the same company and minute, else with a synthetic report
   * per company and day, so every צ׳ shows the same "last seen" as the sheet.
   */
  checks(reports: KesherTab | undefined, checkRows: KesherTab | undefined) {
    const newReports = new Map<string, CheckRow>();
    /** `${unitId}|${iso}` → report sheet key (new or already in the app) */
    const byMinute = new Map<string, string>();
    /** `${checkKey}|${serial}` → line; a בדיקות צ׳ row overrides the report's "not found" text */
    const reportLines = new Map<string, CheckLineRow>();
    const checkLines = new Map<string, CheckLineRow>();
    const synthetic = new Map<string, CheckRow>();
    const unknownReports = new Map<string, number[]>();
    const unknownChecks = new Map<string, number[]>();
    const reportRows: number[] = [];
    const checkRowNums: number[] = [];

    for (const r of reports?.rows ?? []) {
      const companyText = cell(r, 2);
      const place = this.place(companyText);
      if ("error" in place || place.location !== "company") {
        const name = nameKey(companyText) || "—";
        unknownReports.set(name, [...(unknownReports.get(name) ?? []), r.row]);
        continue;
      }
      const at = parseSheetDate(cell(r, 1));
      const total = parseQty(cell(r, 5));
      const found = parseQty(cell(r, 6));
      if (!at || Number.isNaN(total) || Number.isNaN(found) || found < 0 || found > total) {
        this.error("reports", r.row, at ? "מספרים לא תקינים (סה״כ / נבדקו)" : `תאריך לא תקין "${cell(r, 1)}"`, { key: `${r.row}` });
        continue;
      }
      const sheetKey = hash(["kesher-report", place.unit.id, at.toISOString()]);
      byMinute.set(`${place.unit.id}|${at.toISOString()}`, sheetKey);
      if (this.st.checkKeys.has(sheetKey) || newReports.has(sheetKey)) {
        this.same("reports");
        continue;
      }
      newReports.set(sheetKey, {
        sheetKey,
        unitId: place.unit.id,
        at: at.toISOString(),
        reporterName: nullIfBlank(nameKey(cell(r, 3)).slice(0, 120)),
        total,
        found,
        note: nullIfBlank(cell(r, 9).slice(0, 1000)),
      });
      reportRows.push(r.row);
      // "123 (710), 456 (אולר)"
      for (const part of cell(r, 8).split(/[,،\n]+/)) {
        const m = /^\s*([^\s(]+)\s*(?:\(([^)]*)\))?\s*$/.exec(part);
        const serial = m ? normalizeSerial(m[1]) : "";
        if (serial && SERIAL_FORMAT.test(serial)) {
          reportLines.set(`${sheetKey}|${serial}`, { checkKey: sheetKey, serial, item: nullIfBlank(nameKey(m![2] ?? "")), found: false });
        }
      }
    }

    for (const r of checkRows?.rows ?? []) {
      const serial = normalizeSerial(cell(r, 1));
      if (!serial || !SERIAL_FORMAT.test(serial)) continue;
      const companyText = cell(r, 3);
      const place = this.place(companyText);
      if ("error" in place || place.location !== "company") {
        const name = nameKey(companyText) || "—";
        unknownChecks.set(name, [...(unknownChecks.get(name) ?? []), r.row]);
        continue;
      }
      const at = parseSheetDate(cell(r, 4));
      if (!at) {
        this.error("checks", r.row, `תאריך לא תקין "${cell(r, 4)}"`, { key: `${r.row}`, serial });
        continue;
      }
      const found = nameKey(cell(r, 6)) === "נמצא";
      const line = { serial, item: nullIfBlank(nameKey(cell(r, 2))), found };
      const reportKey = byMinute.get(`${place.unit.id}|${at.toISOString()}`);
      if (reportKey) {
        const appId = this.st.checkKeys.get(reportKey);
        if (appId && this.st.checkLineKeys.has(`${appId}|${serial}`)) {
          this.same("checks");
          continue;
        }
        reportLines.delete(`${reportKey}|${serial}`);
        checkLines.set(`${reportKey}|${serial}`, { ...line, checkKey: reportKey });
      } else {
        const key = hash(["kesher-checks", place.unit.id, sheetDay(at)]);
        const appId = this.st.checkKeys.get(key);
        if (appId && this.st.checkLineKeys.has(`${appId}|${serial}`)) {
          this.same("checks");
          continue;
        }
        if (!appId) {
          const c = synthetic.get(key) ?? { sheetKey: key, unitId: place.unit.id, at: at.toISOString(), reporterName: nullIfBlank(nameKey(cell(r, 5)).slice(0, 120)), total: 0, found: 0, note: "ייבוא · בדיקות צ׳" };
          c.total++;
          if (found) c.found++;
          if (at.toISOString() > c.at) c.at = at.toISOString();
          synthetic.set(key, c);
        }
        if (checkLines.has(`${key}|${serial}`)) continue;
        checkLines.set(`${key}|${serial}`, { ...line, checkKey: key });
      }
      checkRowNums.push(r.row);
    }

    this.unknownCompanies("reports", unknownReports, "דוחות");
    this.unknownCompanies("checks", unknownChecks, "בדיקות");
    let reportsLine: string | null = null;
    if (newReports.size) {
      const list = [...newReports.values()];
      reportsLine = this.push("reports", reportRows[0]!, "new", { t: "checks.add", checks: list, lines: [...reportLines.values()] }, {
        key: hash(list.map((c) => c.sheetKey)).slice(0, 16),
        after: `${list.length} דוחות צ׳`,
        message: "נשמרים כדוחות שכבר דווחו — לא תישלח עליהם התראה.",
      });
    }
    if (checkLines.size) {
      const lines = [...checkLines.values()];
      const toNewReport = lines.some((l) => newReports.has(l.checkKey));
      this.push("checks", checkRowNums[0] ?? null, "new", { t: "checks.add", checks: [...synthetic.values()], lines }, {
        key: hash(lines.map((l) => `${l.checkKey}|${l.serial}`)).slice(0, 16),
        after: `${lines.length} בדיקות צ׳${synthetic.size ? ` · ${synthetic.size} דוחות לפי יום` : ""}`,
        message: "שורות בלי דוח מתאים נשמרות בדוח \"ייבוא · בדיקות צ׳\" לפי פלוגה ויום.",
        dependsOn: toNewReport && reportsLine ? [reportsLine] : [],
      });
    }
  }
}

/**
 * Only the tabs in `tabs` (and present in `sheets`) produce lines. `picks` are the soldiers the
 * admin chose for ambiguous names: `${companyId}|${searchKey(name)}` → person id.
 */
export async function diffKesher(
  tx: Tx,
  sheets: KesherSheets,
  tabs: readonly KesherSheetKey[],
  picks: ReadonlyMap<string, string> = new Map(),
): Promise<SheetDiff> {
  const st = await loadState(tx);
  const d = new Differ(st, picks);
  const chosen = <K extends keyof KesherSheets>(k: K & KesherSheetKey) => (tabs.includes(k) ? sheets[k] : undefined);
  // dependencies: פיזור before the company tabs; כללי before תקן; serials before checks
  const pizur = chosen("pizur");
  if (pizur) d.pizur(pizur);
  const companies = chosen("companies");
  if (companies) d.companies(companies);
  const general = chosen("general");
  if (general) d.general(general);
  const kit = chosen("kit");
  if (kit) d.kit(kit);
  const log = chosen("log");
  if (log) d.log(log);
  const reports = chosen("reports");
  const checks = chosen("checks");
  if (reports || checks) d.checks(reports, checks);
  return { lines: d.lines, identical: d.identical, fingerprint: fingerprintLines(d.lines) };
}

export type { SheetRow };
