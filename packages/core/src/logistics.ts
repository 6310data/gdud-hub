/**
 * Logistics domain: constants, labels and pure helpers shared by the database schema,
 * the server actions and the UI. No I/O here.
 */

/** Where a serial is while it is NOT signed out. "חתום" is derived (an open assignment). */
export const LOGISTICS_CONDITIONS = ["ok", "broken", "brigade"] as const;
export type Condition = (typeof LOGISTICS_CONDITIONS)[number];

export const CONDITION_LABEL: Record<Condition, string> = {
  ok: "תקין",
  broken: "תקול",
  brigade: "חטיבה",
};
/** Full wording used in the old sheet / return destinations. */
export const CONDITION_PLACE: Record<Condition, string> = {
  ok: "נשקייה · תקין",
  broken: "נשקייה · תקול",
  brigade: "נשקייה · חטיבה",
};
export const CONDITION_HINT: Record<Condition, string> = {
  ok: "חוזר למלאי וזמין להחתמה מיד",
  broken: "נשאר במחסן, חסום להחתמה עד תיקון",
  brigade: "יוצא ממלאי הגדוד לחטיבה",
};

export function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (LOGISTICS_CONDITIONS as readonly string[]).includes(v);
}

export const LOGISTICS_FORM_KINDS = ["signout", "holdings"] as const;
export type FormKind = (typeof LOGISTICS_FORM_KINDS)[number];

export const LOGISTICS_EVENT_KINDS = [
  "sign",
  "return",
  "transfer",
  "condition",
  "notes",
  "serials_add",
  "serial_remove",
  "item_add",
  "kit",
  "store",
  "release",
  "holdings_form",
  "person_add",
  "person_update",
  "person_remove",
] as const;
export type EventKind = (typeof LOGISTICS_EVENT_KINDS)[number];

export const EVENT_LABEL: Record<EventKind, string> = {
  sign: "החתמה",
  return: "זיכוי",
  transfer: "העברה",
  condition: "שינוי מצב",
  notes: "עדכון הערה",
  serials_add: "הוספת צ׳ים",
  serial_remove: "מחיקת צ׳",
  item_add: "פריט חדש",
  kit: "עדכון תקן",
  store: "אפסון",
  release: "הוצאה מאפסון",
  holdings_form: "טופס ציוד חתום",
  person_add: "חייל חדש",
  person_update: "עדכון חייל",
  person_remove: "הסרת חייל",
};

/* ── serials ─────────────────────────────────────────────────────────────── */

/** Same rule as the sheet: drop spaces and hyphens, and a trailing ".0" left by number cells. */
export function normalizeSerial(v: unknown): string {
  let t = String(v ?? "").trim().replace(/[\s-]/g, "");
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, "");
  return t;
}

/** Text area input ("one per line, or comma separated") → unique normalized serials, in order. */
export function parseSerialList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const k = normalizeSerial(part);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/* ── search ──────────────────────────────────────────────────────────────── */

/** Loose match key: no spaces, hyphens, quotes or geresh/gershayim; lower case. */
export function searchKey(s: unknown): string {
  return String(s ?? "")
    .replace(/[\s\-'"׳״]/g, "")
    .toLowerCase();
}

export function matches(query: string, ...fields: unknown[]): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return fields.some((f) => searchKey(f).includes(q));
}

/* ── kit (ציוד משלים) ─────────────────────────────────────────────────────── */

export interface KitLine {
  name: string;
  qty: number;
}

/** "3 תופים, ערכת כולבו" */
export function kitToString(kit: readonly KitLine[] | null | undefined): string {
  return (kit ?? [])
    .map((k) => {
      const n = k.name.trim();
      return n ? (k.qty > 1 ? `${k.qty} ${n}` : n) : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** Drops empty names, merges duplicates (summing qty), clamps qty to 1..99. */
export function cleanKit(kit: readonly KitLine[]): KitLine[] {
  const out: KitLine[] = [];
  for (const k of kit) {
    const name = k.name.trim();
    if (!name) continue;
    const qty = Math.min(99, Math.max(1, Math.round(Number(k.qty) || 1)));
    const same = out.find((x) => x.name === name);
    if (same) same.qty = Math.min(99, same.qty + qty);
    else out.push({ name, qty });
  }
  return out;
}

/** "3 תופים, רצועה" → lines (the inverse of kitToString; the format of the old 'ציוד משלים' column). */
export function parseKitText(text: string): KitLine[] {
  return cleanKit(
    text
      .split(/[,،\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = /^(\d{1,2})\s+(.+)$/.exec(part);
        return m ? { qty: Number(m[1]), name: m[2]! } : { qty: 1, name: part };
      }),
  );
}

/* ── stock counts ────────────────────────────────────────────────────────── */

export interface StockCounts {
  /** in the armory, can be signed out */
  ok: number;
  broken: number;
  brigade: number;
  signed: number;
  total: number;
}

export const emptyCounts = (): StockCounts => ({ ok: 0, broken: 0, brigade: 0, signed: 0, total: 0 });

/** "במחסן" = in the battalion armory (ok + broken); brigade is outside the battalion. */
export const inArmory = (c: StockCounts): number => c.ok + c.broken;

export function countStock(
  serials: readonly { itemId: string; condition: Condition; held: boolean }[],
): Map<string, StockCounts> {
  const by = new Map<string, StockCounts>();
  for (const s of serials) {
    const c = by.get(s.itemId) ?? emptyCounts();
    c.total++;
    if (s.held) c.signed++;
    else c[s.condition]++;
    by.set(s.itemId, c);
  }
  return by;
}

export function sumCounts(all: Iterable<StockCounts>): StockCounts {
  const t = emptyCounts();
  for (const c of all) {
    t.ok += c.ok;
    t.broken += c.broken;
    t.brigade += c.brigade;
    t.signed += c.signed;
    t.total += c.total;
  }
  return t;
}

/** Percent (0–100, one decimal) for stock bars; 0 when total is 0. */
export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/* ── forms ───────────────────────────────────────────────────────────────── */

export interface FormLine {
  item: string;
  serial: string;
  kit: string;
  notes?: string;
  /** ISO date the line was signed (holdings form) */
  signedAt?: string;
}

/** Everything needed to render a form later, exactly as it was issued. */
export interface LogisticsFormData {
  title: string;
  battalion: string;
  /** ISO timestamp */
  issuedAt: string;
  person: { name: string; personalNumber: string | null; company: string | null; platoon: string | null; phone: string | null };
  lines: FormLine[];
  notes: string;
  signer: string;
  signerTitle: string;
  issuedBy: string;
  declaration: string;
}

export const SIGNOUT_DECLARATION =
  "אני, החתום מטה, מאשר/ת כי קיבלתי את הציוד המפורט לעיל במצב תקין, וכי אני אחראי/ת לשמירתו ולהחזרתו.";

export function holdingsDeclaration(dateLabel: string): string {
  return `אני, החתום מטה, מאשר/ת כי נכון לתאריך ${dateLabel} מוחתם/ת עליי הציוד המפורט לעיל, וכי אני אחראי/ת לשמירתו ולהחזרתו.`;
}

/** "M4 קצר × 2 · כוונת M5 × 1" — per-item totals for forms with several lines. */
export function lineTotals(lines: readonly Pick<FormLine, "item">[]): Array<{ item: string; count: number }> {
  const out: Array<{ item: string; count: number }> = [];
  for (const l of lines) {
    const row = out.find((x) => x.item === l.item);
    if (row) row.count++;
    else out.push({ item: l.item, count: 1 });
  }
  return out;
}

/** Hebrew-aware sort helpers. */
export const byHe = (a: string, b: string): number => a.localeCompare(b, "he", { numeric: true });
