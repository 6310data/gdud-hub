"use client";
/**
 * זיכוי לחטיבה: tap warehouse צ׳ (תקינים or תקולים, grouped by device type) and fill how many of
 * each ציוד משלים item go back, תקין and תקול apart. A confirm sheet sums it up before sending.
 */
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { matches } from "@gdud/core";
import { Button, Chip, Icon, Serial } from "@gdud/ui";
import { Empty } from "@/components/page-parts";
import { fmtCount } from "@/lib/logistics/format";
import { returnToBrigade } from "../../_actions/moves";
import { checkDay, ErrorAlert, MoveFields, qtyOf, QtyInput, Toast, useToast } from "./shared";

export interface OutSerial {
  id: string;
  serial: string;
  item: string;
  broken: boolean;
}
export interface OutBulk {
  id: string;
  name: string;
  category: string | null;
  /** warehouse תקין */
  available: number;
  /** warehouse תקול */
  broken: number;
}

type Show = "all" | "ok" | "broken";
const SHOW_LABEL: Record<Show, string> = { all: "הכל", ok: "תקינים", broken: "תקולים" };

export function BrigadeOut({ today, serials, bulk }: { today: string; serials: OutSerial[]; bulk: OutBulk[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [qty, setQty] = useState<Record<string, { ok: string; broken: string }>>({});
  const [day, setDay] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useToast();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  const groups = useMemo(() => {
    const out = new Map<string, OutSerial[]>();
    for (const x of serials) {
      if ((show === "all" || x.broken === (show === "broken")) && matches(q, x.serial, x.item)) {
        const g = out.get(x.item);
        if (g) g.push(x);
        else out.set(x.item, [x]);
      }
    }
    return [...out];
  }, [serials, show, q]);
  const cats = useMemo(() => {
    const out = new Map<string, OutBulk[]>();
    for (const b of bulk) {
      const g = out.get(b.category ?? "");
      if (g) g.push(b);
      else out.set(b.category ?? "", [b]);
    }
    return [...out];
  }, [bulk]);

  const toggle = (ids: readonly string[], on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const setCell = (itemId: string, k: "ok" | "broken", v: string) => setQty((cur) => ({ ...cur, [itemId]: { ok: "", broken: "", ...cur[itemId], [k]: v } }));

  const lines = bulk.map((b) => ({ b, ok: qtyOf(qty[b.id]?.ok), broken: qtyOf(qty[b.id]?.broken) }));
  const badLines = lines.filter((l) => Number.isNaN(l.ok) || Number.isNaN(l.broken) || l.ok > l.b.available || l.broken > l.b.broken);
  const sendLines = lines.filter((l) => l.ok + l.broken > 0);
  const units = sendLines.reduce((n, l) => n + l.ok + l.broken, 0);
  const chosenList = serials.filter((x) => chosen.has(x.id));
  const chosenBroken = chosenList.filter((x) => x.broken).length;

  function review() {
    setError(undefined);
    const dayError = checkDay(day, today);
    if (dayError) return setError(dayError);
    if (badLines.length) return setError(badLines.map((l) => `${l.b.name}: במחסן ${l.b.available} תקינים ו־${l.b.broken} תקולים`).join("\n"));
    if (!chosen.size && !units) return setError("לא נבחר ציוד");
    setConfirming(true);
  }

  function send() {
    start(async () => {
      const r = await returnToBrigade({
        day: day || null,
        notes: notes.trim() || null,
        serialIds: [...chosen],
        lines: sendLines.map((l) => ({ itemId: l.b.id, ok: l.ok, broken: l.broken })),
      });
      setConfirming(false);
      if (!r.ok) return setError(r.error);
      setToast(`זוכו לחטיבה: ${[r.data.serials ? `${fmtCount(r.data.serials)} צ׳` : "", units ? `${fmtCount(units)} יח׳ ציוד משלים` : ""].filter(Boolean).join(" · ")}`);
      setChosen(new Set());
      setQty({});
      setNotes("");
      setDay(today);
      router.refresh();
    });
  }

  const summary = [chosen.size ? `${fmtCount(chosen.size)} צ׳${chosenBroken ? ` (${fmtCount(chosenBroken)} תקולים)` : ""}` : "", units ? `${fmtCount(units)} יח׳ ציוד משלים` : ""].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="צ׳ במחסן">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="tz-panel-title">
            צ׳ במחסן · {fmtCount(chosen.size)}/{fmtCount(serials.length)} נבחרו
          </h2>
          {chosen.size ? (
            <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => setChosen(new Set())} disabled={pending}>
              ניקוי הבחירה
            </button>
          ) : null}
        </div>
        {serials.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="tz-search min-w-[220px] flex-1 bg-surface lg:max-w-[320px]">
              <Icon name="search" size={15} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש צ׳ או סוג מכשיר" aria-label="חיפוש צ׳ או סוג מכשיר" autoComplete="off" />
            </label>
            <div className="tz-pills" role="group" aria-label="מצב">
              {(Object.keys(SHOW_LABEL) as Show[]).map((k) => (
                <button key={k} type="button" className="tz-pill" aria-pressed={show === k} onClick={() => setShow(k)}>
                  {SHOW_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!serials.length ? (
          <div className="tz-card">
            <Empty>אין צ׳ במחסן</Empty>
          </div>
        ) : !groups.length ? (
          <div className="tz-card">
            <Empty>לא נמצא צ׳</Empty>
          </div>
        ) : (
          groups.map(([type, list]) => {
            const ids = list.map((x) => x.id);
            const on = ids.filter((id) => chosen.has(id)).length;
            return (
              <section key={type} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 px-4">
                  <h3 className="tz-section-header m-0 p-0">
                    {type}{" "}
                    <span className="tz-num font-normal">
                      · {fmtCount(on)}/{fmtCount(ids.length)}
                    </span>
                  </h3>
                  <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => toggle(ids, on < ids.length)} disabled={pending}>
                    {on < ids.length ? "בחירת הקבוצה" : "ביטול הקבוצה"}
                  </button>
                </div>
                <div className="tz-group">
                  {list.map((x) => (
                    <label key={x.id} className="tz-row cursor-pointer">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 self-center"
                        checked={chosen.has(x.id)}
                        onChange={(e) => toggle([x.id], e.target.checked)}
                        disabled={pending}
                        aria-label={`${x.item} ${x.serial}`}
                      />
                      <span className="tz-row-body">
                        <span className="tz-row-title">
                          <Serial>{x.serial}</Serial>
                        </span>
                        {x.broken ? <Chip tone="broken">תקול</Chip> : <Chip tone="ok">תקין</Chip>}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-1.5" aria-label="ציוד משלים">
        <h2 className="tz-panel-title px-1">ציוד משלים</h2>
        {bulk.length ? (
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th>פריט</th>
                  <th>תקין במחסן</th>
                  <th>תקול במחסן</th>
                  <th>תקין לזיכוי</th>
                  <th>תקול לזיכוי</th>
                </tr>
              </thead>
              <tbody>
                {cats.map(([cat, list]) => (
                  <Fragment key={cat}>
                    {cats.length > 1 || cat ? (
                      <tr className="tz-group-row">
                        <th colSpan={5}>{cat || "ללא קטגוריה"}</th>
                      </tr>
                    ) : null}
                    {list.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td className={`tz-num ${b.available ? "" : "tz-zero"}`}>{fmtCount(b.available)}</td>
                        <td className={`tz-num ${b.broken ? "" : "tz-zero"}`}>{fmtCount(b.broken)}</td>
                        <td>
                          {b.available ? (
                            <QtyInput value={qty[b.id]?.ok ?? ""} max={b.available} label={`${b.name} · תקין לזיכוי`} onChange={(v) => setCell(b.id, "ok", v)} disabled={pending} />
                          ) : (
                            <span className="tz-zero">—</span>
                          )}
                        </td>
                        <td>
                          {b.broken ? (
                            <QtyInput value={qty[b.id]?.broken ?? ""} max={b.broken} label={`${b.name} · תקול לזיכוי`} onChange={(v) => setCell(b.id, "broken", v)} disabled={pending} />
                          ) : (
                            <span className="tz-zero">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tz-card">
            <Empty>אין ציוד משלים במחסן</Empty>
          </div>
        )}
      </section>

      <section className="tz-card flex flex-col gap-3 p-4" aria-label="פרטי הזיכוי">
        <MoveFields today={today} day={day} notes={notes} onDay={setDay} onNotes={setNotes} disabled={pending} />
        <ErrorAlert error={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="danger" onClick={review} disabled={pending || (!chosen.size && !units)}>
            זיכוי לחטיבה
          </Button>
          <span className="tz-footnote">{summary || "לא נבחר ציוד"}</span>
        </div>
        <span className="tz-footnote">צ׳ שזוכה לחטיבה נשאר בהיסטוריה (יומן) ויוצא מכל הספירות.</span>
      </section>

      {confirming ? (
        <>
          <button type="button" className="tz-scrim" aria-label="סגירה" onClick={() => setConfirming(false)} />
          <div className="tz-sheet flex flex-col gap-3 px-4" role="dialog" aria-modal="true" aria-label="זיכוי לחטיבה">
            <div className="tz-grabber" />
            <span className="tz-headline">זיכוי לחטיבה</span>
            <p className="m-0">{summary} ייצאו מהמחסן ומהמלאי הכללי.</p>
            {chosenList.length ? (
              <p className="m-0 flex flex-wrap gap-x-2 gap-y-1 text-[14px]">
                {chosenList.slice(0, 40).map((x) => (
                  <Serial key={x.id}>{x.serial}</Serial>
                ))}
                {chosenList.length > 40 ? <span className="text-ink-muted">ועוד {fmtCount(chosenList.length - 40)}</span> : null}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" onClick={send} loading={pending}>
                זיכוי
              </Button>
              <Button type="button" variant="plain" onClick={() => setConfirming(false)} disabled={pending}>
                חזרה
              </Button>
            </div>
          </div>
        </>
      ) : null}
      <Toast msg={toast} />
    </div>
  );
}
