"use client";
/**
 * Sorting by column for every table of the app (`tz-table`, `tz-board`): click a header (or Enter /
 * Space on it) to sort ascending, again for descending. Rows sort inside their group — a
 * `tz-group-row` or any row with a spanning cell stays in place and splits the body. A cell sorts by
 * its `data-sort` (on it or inside it, e.g. an ISO time) or else its text: numbers and dates
 * (with a year or a time) by value, the rest in Hebrew order, blank and "—" last either way; a cell
 * that is only a radio / checkbox sorts the checked ones first.
 *
 * Works on the DOM, after React: the rows keep their React keys, and when React re-renders a sorted
 * table (a refresh, a saved edit) the sort is applied again. Headers are marked only once React has
 * hydrated the table (server HTML must match until then). A header opts out with `data-nosort`;
 * headers without visible text (checkboxes, actions) are never sortable.
 */
import { useEffect } from "react";

const TABLES = "table.tz-table, table.tz-board";
type Dir = "ascending" | "descending";

const active = new Map<HTMLTableElement, { col: number; dir: Dir }>();
/** first-seen order, for ties */
const firstSeen = new WeakMap<HTMLTableRowElement, number>();
let seen = 0;

function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement && (node.classList.contains("sr-only") || node.tagName === "INPUT")) return "";
  let s = "";
  for (const c of node.childNodes) s += visibleText(c);
  return s;
}

const headerRow = (t: HTMLTableElement) => (t.tHead?.rows.length ? t.tHead.rows[t.tHead.rows.length - 1]! : null);

function colOf(th: HTMLTableCellElement): number {
  let i = 0;
  for (const c of (th.parentElement as HTMLTableRowElement).cells) {
    if (c === th) return i;
    i += c.colSpan;
  }
  return -1;
}

function cellAt(tr: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let i = 0;
  for (const c of tr.cells) {
    if (col < i + c.colSpan) return i === col ? c : null;
    i += c.colSpan;
  }
  return null;
}

const isBoundary = (tr: HTMLTableRowElement) => tr.classList.contains("tz-group-row") || tr.hasAttribute("data-nosort") || [...tr.cells].some((c) => c.colSpan > 1);

type Key = { kind: 0; n: number } | { kind: 1; s: string } | { kind: 2 };

function keyOf(cell: HTMLTableCellElement | null): Key {
  if (!cell) return { kind: 2 };
  const tagged = cell.dataset.sort ?? cell.querySelector<HTMLElement>("[data-sort]")?.dataset.sort;
  const raw = (tagged ?? visibleText(cell)).replace(/\s+/g, " ").trim();
  // a cell that is only a radio / checkbox (a value column on יום גיוס): the checked ones first
  if (!raw && tagged === undefined) {
    const input = cell.querySelector<HTMLInputElement>("input[type=radio], input[type=checkbox]");
    if (input) return input.checked ? { kind: 0, n: 0 } : { kind: 2 };
  }
  if (!raw || raw === "—" || raw === "-") return { kind: 2 };
  // fmtDate / fmtDay "19.10.2026", fmtWhen "28.09 18:05" / "היום 10:42" — a date has a year or a time
  const date = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?:\s*·?\s*(\d{1,2}):(\d{2}))?$/.exec(raw);
  if (date && (date[3] || date[4])) {
    const [, d, m, y, hh, mm] = date;
    return { kind: 0, n: Date.UTC(y ? Number(y) : new Date().getFullYear(), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0)) };
  }
  const near = /^(היום|אתמול)\s+(\d{1,2}):(\d{2})$/.exec(raw);
  if (near) {
    const t = new Date();
    return { kind: 0, n: Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() - (near[1] === "אתמול" ? 1 : 0), Number(near[2]), Number(near[3])) };
  }
  const num = raw.replace(/[,‎‏%₪]/g, "").replace(/^\+/, "").replace(/−/g, "-");
  if (/^-?\d+(\.\d+)?$/.test(num)) return { kind: 0, n: Number(num) };
  return { kind: 1, s: raw };
}

const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });

function compare(a: Key, b: Key, dir: Dir): number {
  if (a.kind === 2 || b.kind === 2) return a.kind === b.kind ? 0 : a.kind === 2 ? 1 : -1; // blanks last
  const sign = dir === "ascending" ? 1 : -1;
  if (a.kind !== b.kind) return (a.kind - b.kind) * sign;
  return (a.kind === 0 ? a.n - (b as { n: number }).n : collator.compare(a.s, (b as { s: string }).s)) * sign;
}

/** Puts the rows in order; touches the DOM only when the order differs (so it can run on every mutation). */
function apply(table: HTMLTableElement) {
  const st = active.get(table);
  if (!st) return;
  for (const body of table.tBodies) {
    const rows = [...body.rows];
    for (const r of rows) if (!firstSeen.has(r)) firstSeen.set(r, seen++);
    let segment: HTMLTableRowElement[] = [];
    const flush = (before: HTMLTableRowElement | null) => {
      if (segment.length > 1) {
        const keyed = segment.map((r) => ({ r, k: keyOf(cellAt(r, st.col)) }));
        const want = [...keyed].sort((a, b) => compare(a.k, b.k, st.dir) || firstSeen.get(a.r)! - firstSeen.get(b.r)!).map((x) => x.r);
        if (want.some((r, i) => r !== segment[i])) for (const r of want) body.insertBefore(r, before);
      }
      segment = [];
    };
    for (const r of rows) {
      if (isBoundary(r)) flush(r);
      else segment.push(r);
    }
    flush(null);
  }
}

function sortable(th: HTMLTableCellElement): boolean {
  return !th.hasAttribute("data-nosort") && th.colSpan === 1 && visibleText(th).trim() !== "";
}

/** React has hydrated (or rendered) the element: touching server HTML before that breaks hydration. */
const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));

/** Marks the sortable headers of tables that showed up since the last pass; true = a table is still waiting for hydration. */
function decorate(): boolean {
  let waiting = false;
  for (const table of document.querySelectorAll<HTMLTableElement>(TABLES)) {
    const head = headerRow(table);
    if (!head) continue;
    if (!hydrated(table)) {
      waiting = true;
      continue;
    }
    for (const th of head.cells) {
      if (th.hasAttribute("data-sortable") || !sortable(th)) continue;
      th.setAttribute("data-sortable", "");
      th.tabIndex = 0;
      th.title ||= "מיון לפי העמודה";
    }
  }
  return waiting;
}

function toggle(th: HTMLTableCellElement) {
  const table = th.closest("table") as HTMLTableElement;
  const col = colOf(th);
  const cur = active.get(table);
  const dir: Dir = cur?.col === col && cur.dir === "ascending" ? "descending" : "ascending";
  active.set(table, { col, dir });
  for (const c of headerRow(table)?.cells ?? []) if (c !== th) c.removeAttribute("aria-sort");
  th.setAttribute("aria-sort", dir);
  apply(table);
}

export function TableSort() {
  useEffect(() => {
    const headerOf = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest("input, button, a, select, label")) return null;
      const th = el.closest<HTMLTableCellElement>("thead th[data-sortable]");
      return th?.closest(TABLES) ? th : null;
    };
    const onClick = (e: MouseEvent) => {
      const th = headerOf(e);
      if (th) toggle(th);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const th = headerOf(e);
      if (!th) return;
      e.preventDefault();
      toggle(th);
    };
    let queued = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const pass = () => {
      queued = 0;
      clearTimeout(retry);
      // hydration changes no DOM, so no mutation tells us it happened: look again shortly
      if (decorate()) retry = setTimeout(pass, 150);
      for (const t of active.keys()) {
        if (!t.isConnected) active.delete(t);
        else apply(t);
      }
    };
    const observer = new MutationObserver(() => {
      queued ||= requestAnimationFrame(pass);
    });
    pass();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(queued);
      clearTimeout(retry);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
