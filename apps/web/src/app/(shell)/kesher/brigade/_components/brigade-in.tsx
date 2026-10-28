"use client";
/**
 * קבלה מחטיבה: rows of (סוג מכשיר, צ׳) — typed one by one (Enter adds a row) or pasted as a list
 * of one type — and ציוד משלים lines that raise מלאי כללי. Each צ׳ is checked as it is typed against
 * the צ׳ already in the system: a צ׳ that is there is refused, one returned to the brigade earlier
 * comes back (same device type only).
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { KESHER_LOCATION_LABEL, normalizeSerial, parseSerialList, type KesherLocation } from "@gdud/core";
import { Button, Icon } from "@gdud/ui";
import { fmtCount } from "@/lib/logistics/format";
import { receiveFromBrigade } from "../../_actions/moves";
import { checkDay, ErrorAlert, MoveFields, qtyOf, QtyInput, Toast, useToast } from "./shared";

export interface KnownSerial {
  serial: string;
  itemId: string;
  item: string;
  location: KesherLocation;
}
export interface InBulk {
  id: string;
  name: string;
  category: string | null;
  brigadeQty: number | null;
}

interface Row {
  key: number;
  itemId: string;
  serial: string;
}
interface Line {
  key: number;
  itemId: string;
  qty: string;
}
type Status = { tone: "error" | "info"; text: string } | null;

const SERIAL_RE = /^[^\s]{1,40}$/;
let nextKey = 1;
const newRow = (itemId = ""): Row => ({ key: nextKey++, itemId, serial: "" });

export function BrigadeIn({ today, types, bulk, known }: { today: string; types: { id: string; name: string }[]; bulk: InBulk[]; known: KnownSerial[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [focusKey, setFocusKey] = useState<number>();
  const [pasting, setPasting] = useState(false);
  const [pasteType, setPasteType] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [day, setDay] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [toast, setToast] = useToast();
  const [pending, start] = useTransition();

  const knownBy = useMemo(() => new Map(known.map((k) => [k.serial, k])), [known]);
  const bulkBy = useMemo(() => new Map(bulk.map((b) => [b.id, b])), [bulk]);
  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types]);

  /* ── צ׳ rows ── */
  const norm = rows.map((r) => normalizeSerial(r.serial));
  const seen = new Map<string, number>();
  for (const n of norm) if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
  const statusOf = (r: Row, n: string): Status => {
    if (!n) return null;
    if (!SERIAL_RE.test(n)) return { tone: "error", text: "צ׳ לא תקין (עד 40 תווים)" };
    if ((seen.get(n) ?? 0) > 1) return { tone: "error", text: "מופיע פעמיים ברשימה" };
    const k = knownBy.get(n);
    if (k && k.location !== "brigade") return { tone: "error", text: `כבר קיים במערכת · ${k.item} · ${KESHER_LOCATION_LABEL[k.location]}` };
    if (k && r.itemId && k.itemId !== r.itemId) return { tone: "error", text: `הוחזר לחטיבה כ${k.item} — בחרו את הסוג הזה` };
    if (!r.itemId) return { tone: "error", text: "בחרו סוג מכשיר" };
    if (k) return { tone: "info", text: "הוחזר לחטיבה בעבר — ייקלט חזרה למחסן" };
    return null;
  };
  const statuses = rows.map((r, i) => statusOf(r, norm[i]!));
  const filled = rows.filter((_, i) => norm[i]);
  const rowErrors = statuses.filter((s) => s?.tone === "error").length;

  const setRow = (key: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const r = newRow(rows.at(-1)?.itemId ?? "");
    setRows((cur) => [...cur, r]);
    setFocusKey(r.key);
  };
  const removeRow = (key: number) => setRows((cur) => (cur.length > 1 ? cur.filter((r) => r.key !== key) : [newRow(cur[0]?.itemId ?? "")]));

  const pasted = parseSerialList(pasteText);
  function addPasted() {
    if (!pasted.length || !pasteType) return;
    setRows((cur) => [...cur.filter((r) => r.serial.trim()), ...pasted.map((serial) => ({ key: nextKey++, itemId: pasteType, serial }))]);
    setPasteText("");
    setPasting(false);
  }

  /* ── ציוד משלים lines ── */
  const usedItems = new Set(lines.map((l) => l.itemId));
  const lineQty = lines.map((l) => qtyOf(l.qty));
  const lineErrors = lines.filter((l, i) => !l.itemId || Number.isNaN(lineQty[i]!)).length;
  const setLine = (key: number, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const unitsIn = lines.reduce((n, l, i) => n + (l.itemId && lineQty[i]! > 0 ? lineQty[i]! : 0), 0);

  function submit() {
    setError(undefined);
    const dayError = checkDay(day, today);
    if (dayError) return setError(dayError);
    if (rowErrors || lineErrors) return setError("יש שורות לתיקון (מסומנות באדום)");
    const serials = filled.map((r) => ({ itemId: r.itemId, serial: normalizeSerial(r.serial) }));
    const out = lines.map((l, i) => ({ itemId: l.itemId, qty: lineQty[i]! })).filter((l) => l.qty > 0);
    if (!serials.length && !out.length) return setError("לא הוזן ציוד");
    start(async () => {
      const r = await receiveFromBrigade({ day: day || null, notes: notes.trim() || null, serials, lines: out });
      if (!r.ok) return setError(r.error);
      setToast(`נקלטו למחסן: ${[r.data.serials ? `${fmtCount(r.data.serials)} צ׳` : "", out.length ? `${fmtCount(out.reduce((n, l) => n + l.qty, 0))} יח׳ ציוד משלים` : ""].filter(Boolean).join(" · ")}`);
      setRows([newRow(rows.at(-1)?.itemId ?? "")]);
      setLines([]);
      setNotes("");
      setDay(today);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5" aria-label="צ׳">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="tz-panel-title">צ׳ · {fmtCount(filled.length)}</h2>
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => setPasting((v) => !v)} aria-expanded={pasting}>
            <Icon name="list" size={16} />
            הדבקת רשימה
          </button>
        </div>

        {pasting ? (
          <div className="tz-card flex flex-col gap-3 p-4">
            <label className="tz-field">
              <span className="tz-label">סוג מכשיר לכל הרשימה</span>
              <select className="tz-input" value={pasteType} onChange={(e) => setPasteType(e.target.value)}>
                <option value="">בחרו סוג…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tz-field">
              <span className="tz-label">צ׳ — אחד בכל שורה</span>
              <textarea className="tz-input tz-serial min-h-32" dir="ltr" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"123456\n123457"} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="tinted" small onClick={addPasted} disabled={!pasted.length || !pasteType}>
                {pasted.length ? `הוספת ${fmtCount(pasted.length)} צ׳` : "הוספה"}
              </Button>
              <Button type="button" variant="plain" small onClick={() => setPasting(false)}>
                ביטול
              </Button>
              {!pasteType && pasted.length ? <span className="tz-footnote">בחרו סוג מכשיר</span> : null}
            </div>
          </div>
        ) : null}

        <div className="tz-card flex flex-col">
          {rows.map((r, i) => {
            const st = statuses[i];
            return (
              <div key={r.key} className="flex flex-col gap-1 border-b border-separator px-3 py-2.5 last:border-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <select
                    className="tz-input col-span-2 sm:col-span-1"
                    value={r.itemId}
                    onChange={(e) => setRow(r.key, { itemId: e.target.value })}
                    aria-label={`סוג מכשיר, שורה ${i + 1}`}
                    disabled={pending}
                  >
                    <option value="">סוג מכשיר…</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`tz-input tz-serial ${st?.tone === "error" && norm[i] ? "text-danger" : ""}`}
                    dir="ltr"
                    value={r.serial}
                    maxLength={60}
                    placeholder="צ׳"
                    autoComplete="off"
                    autoFocus={r.key === focusKey}
                    aria-label={`צ׳, שורה ${i + 1}`}
                    aria-invalid={st?.tone === "error" || undefined}
                    onChange={(e) => setRow(r.key, { serial: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (i === rows.length - 1 && r.serial.trim()) addRow();
                      }
                    }}
                    disabled={pending}
                  />
                  <button type="button" className="tz-icon-btn" onClick={() => removeRow(r.key)} aria-label={`הסרת שורה ${i + 1}`} disabled={pending}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {st ? <span className={`text-xs ${st.tone === "error" ? "text-danger" : "text-ink-muted"}`}>{st.text}</span> : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-1">
          <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={addRow} disabled={pending}>
            <Icon name="plus" size={16} />
            הוספת שורה
          </button>
          <span className="tz-footnote">Enter בשדה הצ׳ מוסיף שורה מאותו סוג</span>
        </div>
      </section>

      <section className="flex flex-col gap-1.5" aria-label="ציוד משלים">
        <h2 className="tz-panel-title px-1">ציוד משלים</h2>
        <div className="tz-card flex flex-col">
          {lines.map((l, i) => {
            const it = bulkBy.get(l.itemId);
            const q = lineQty[i]!;
            const before = it?.brigadeQty ?? 0;
            return (
              <div key={l.key} className="flex flex-col gap-1 border-b border-separator px-3 py-2.5 last:border-0">
                <div className="flex items-center gap-2">
                  <select className="tz-input min-w-0 flex-1" value={l.itemId} onChange={(e) => setLine(l.key, { itemId: e.target.value })} aria-label={`פריט, שורה ${i + 1}`} disabled={pending}>
                    <option value="">פריט…</option>
                    {bulk
                      .filter((b) => b.id === l.itemId || !usedItems.has(b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.category ? `${b.name} · ${b.category}` : b.name}
                        </option>
                      ))}
                  </select>
                  <QtyInput value={l.qty} label={`כמות, ${it?.name ?? `שורה ${i + 1}`}`} onChange={(v) => setLine(l.key, { qty: v })} disabled={pending} />
                  <button type="button" className="tz-icon-btn" onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))} aria-label={`הסרת שורה ${i + 1}`} disabled={pending}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {it ? (
                  <span className="text-xs text-ink-muted">
                    מלאי כללי:{" "}
                    <span className="tz-num">
                      {it.brigadeQty === null ? "לא ידוע" : fmtCount(before)}
                      {q > 0 ? ` ← ${fmtCount(before + q)}` : ""}
                    </span>
                  </span>
                ) : null}
              </div>
            );
          })}
          {!lines.length ? <p className="tz-footnote m-0 px-4 py-3">אין ציוד משלים בקבלה הזו</p> : null}
        </div>
        <div className="px-1">
          <button
            type="button"
            className="tz-btn tz-btn-plain tz-btn-sm px-0"
            onClick={() => setLines((cur) => [...cur, { key: nextKey++, itemId: "", qty: "" }])}
            disabled={pending || lines.length >= bulk.length}
          >
            <Icon name="plus" size={16} />
            הוספת פריט
          </button>
        </div>
      </section>

      <section className="tz-card flex flex-col gap-3 p-4" aria-label="פרטי הקבלה">
        <MoveFields today={today} day={day} notes={notes} onDay={setDay} onNotes={setNotes} disabled={pending} />
        <ErrorAlert error={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={submit} loading={pending} disabled={!filled.length && !unitsIn}>
            קבלה למחסן
          </Button>
          <span className="tz-footnote">
            {fmtCount(filled.length)} צ׳{unitsIn ? ` · ${fmtCount(unitsIn)} יח׳ ציוד משלים` : ""}
            {filled.length ? ` · ${[...new Set(filled.map((r) => typeName.get(r.itemId)).filter(Boolean))].join(", ")}` : ""}
          </span>
        </div>
        <span className="tz-footnote">הצ׳ נקלטים למחסן כתקינים. ציוד משלים מעלה את המלאי הכללי.</span>
      </section>
      <Toast msg={toast} />
    </div>
  );
}
