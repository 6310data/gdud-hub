"use client";
/**
 * צהוב בעיניים: a checkbox per צ׳, grouped by place and device type ("סימון קבוצה"), filters by the
 * last check's color and a search by צ׳, and a sticky bar with "שמירה — נראו בעין". The ticks are
 * kept as a draft in this browser until saved.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { AgeTone } from "@gdud/core";
import { Icon, Serial, Spinner, tintStyle } from "@gdud/ui";
import { markSeen } from "../../_actions/eye";

export interface EyeRow {
  id: string;
  serial: string;
  /** the holder inside the company */
  holder: string | null;
  tone: AgeTone;
  /** the last צהוב בעיניים, rendered on the server */
  chip: ReactNode;
}
export interface EyeGroup {
  type: string;
  rows: EyeRow[];
}
export interface EyePlace {
  /** "warehouse" | "none" | a company id */
  id: string;
  name: string;
  color: string | null;
  groups: EyeGroup[];
}

type Filter = "all" | "warn" | "alert" | "none";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "warn", label: "צהוב" },
  { id: "alert", label: "אדום" },
  { id: "none", label: "לא נבדק" },
];
const shows = (f: Filter, r: EyeRow) => f === "all" || r.tone === f;

const DRAFT_KEY = "kesher-eye";
const TOAST_MS = 4000;
/** markSeen's limit per call */
const BATCH = 1000;
const noSubscribe = () => () => {};

/** The draft's raw text on this device ("" on the server and when storage is blocked). */
function readDraft(): string {
  try {
    return window.localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function parseDraft(raw: string, ids: ReadonlySet<string>): Set<string> {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && ids.has(id)) : []);
  } catch {
    return new Set();
  }
}
function writeDraft(seen: ReadonlySet<string> | null) {
  try {
    if (seen?.size) window.localStorage.setItem(DRAFT_KEY, JSON.stringify([...seen]));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // private mode / blocked storage: the draft just isn't kept
  }
}

export function EyeForm({ places }: { places: EyePlace[] }) {
  const router = useRouter();
  const all = useMemo(() => places.flatMap((p) => p.groups.flatMap((g) => g.rows)), [places]);
  const ids = useMemo(() => new Set(all.map((r) => r.id)), [all]);
  const stored = useSyncExternalStore(noSubscribe, readDraft, () => "");
  /** null = nothing ticked here yet: the stored draft */
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null);
  const seen = ticked ?? parseDraft(stored, ids);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const setSeen = (next: ReadonlySet<string>) => {
    setTicked(next);
    writeDraft(next);
  };
  const toggle = (list: readonly string[], on: boolean) => {
    const next = new Set(seen);
    for (const id of list) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSeen(next);
  };

  const needle = q.trim().toLowerCase();
  const visible = (r: EyeRow) => shows(filter, r) && (!needle || r.serial.toLowerCase().includes(needle));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((r) => shows(f.id, r)).length])) as Record<Filter, number>;
  const shown = places
    .map((p) => ({ ...p, groups: p.groups.map((g) => ({ ...g, rows: g.rows.filter(visible) })).filter((g) => g.rows.length) }))
    .filter((p) => p.groups.length);

  function save() {
    setError(undefined);
    start(async () => {
      // markSeen takes up to BATCH at a time; what was saved leaves the draft even if a later batch fails
      const left = new Set(seen);
      let saved = 0;
      for (let i = 0; left.size && i < seen.size; i += BATCH) {
        const batch = [...left].slice(0, BATCH);
        const r = await markSeen({ serialIds: batch });
        if (!r.ok) {
          setSeen(left);
          setError(saved ? `${saved} צ׳ נשמרו. ${r.error}` : r.error);
          if (saved) router.refresh();
          return;
        }
        saved += r.data.seen;
        for (const id of batch) left.delete(id);
      }
      writeDraft(null);
      setTicked(new Set());
      setToast(`${saved.toLocaleString("he-IL")} צ׳ נרשמו כנראו בעין`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <label className="tz-search min-w-[200px] flex-1 bg-surface lg:max-w-[280px]" role="search">
          <Icon name="search" size={15} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש צ׳" aria-label="חיפוש צ׳" autoComplete="off" inputMode="search" />
        </label>
        <nav className="tz-pills" aria-label="סינון לפי הבדיקה האחרונה">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="tz-pill" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="tz-pill-count">{counts[f.id].toLocaleString("he-IL")}</span>
            </button>
          ))}
        </nav>
      </div>

      {shown.length ? (
        shown.map((p) => {
          const placeIds = p.groups.flatMap((g) => g.rows.map((r) => r.id));
          const placeOn = placeIds.filter((id) => seen.has(id)).length;
          return (
            <section key={p.id} className="flex flex-col gap-3" aria-label={p.name}>
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="m-0 flex items-center gap-2 text-[20px] font-bold leading-[26px]">
                  {p.color ? <span aria-hidden="true" className="tz-dot" style={tintStyle(p.color)} /> : null}
                  {p.name}
                  <span className="tz-num text-[15px] font-normal text-ink-muted">
                    · {placeOn}/{placeIds.length}
                  </span>
                </h2>
                <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => toggle(placeIds, placeOn < placeIds.length)} disabled={pending}>
                  {placeOn < placeIds.length ? "סימון הכל" : "ביטול הכל"}
                </button>
              </div>
              {p.groups.map((g) => {
                const groupIds = g.rows.map((r) => r.id);
                const on = groupIds.filter((id) => seen.has(id)).length;
                return (
                  <div key={g.type} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 px-4">
                      <h3 className="tz-section-header m-0 p-0">
                        {g.type}{" "}
                        <span className="tz-num font-normal">
                          · {on}/{groupIds.length}
                        </span>
                      </h3>
                      <button type="button" className="tz-btn tz-btn-plain tz-btn-sm px-0" onClick={() => toggle(groupIds, on < groupIds.length)} disabled={pending}>
                        {on < groupIds.length ? "סימון קבוצה" : "ביטול הקבוצה"}
                      </button>
                    </div>
                    <div className="tz-group">
                      {g.rows.map((r) => (
                        <label key={r.id} className="tz-row cursor-pointer">
                          <input
                            type="checkbox"
                            className="size-5 shrink-0"
                            checked={seen.has(r.id)}
                            onChange={(e) => toggle([r.id], e.target.checked)}
                            disabled={pending}
                            aria-label={`${g.type} ${r.serial} נראה בעין`}
                          />
                          <span className="tz-row-body">
                            <span className="tz-row-title">
                              <Serial>{r.serial}</Serial>
                              <span className="tz-row-sub">{[g.type, r.holder].filter(Boolean).join(" · ")}</span>
                            </span>
                            {r.chip}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })
      ) : (
        <div className="tz-card p-6 text-center text-[14px] text-ink-muted">{all.length ? "אין צ׳ תואם" : "אין צ׳ במערכת"}</div>
      )}

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}

      <div className="tz-action-bar lg:sticky lg:bottom-4 lg:rounded-group">
        <span className="text-[15px] font-semibold">
          <span className="tz-num">{seen.size.toLocaleString("he-IL")}</span> סומנו
        </span>
        <button type="button" className="tz-btn tz-btn-plain tz-btn-sm ms-auto" onClick={() => setSeen(new Set())} disabled={pending || !seen.size}>
          ניקוי
        </button>
        <button type="button" className="tz-btn tz-btn-filled tz-btn-sm" onClick={save} disabled={pending || !seen.size} aria-busy={pending || undefined}>
          {pending ? <Spinner size={14} /> : null}
          שמירה — נראו בעין
        </button>
      </div>

      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
