"use client";
import { useMemo, useState } from "react";
import { matches } from "@gdud/core";
import { Avatar, Button, Icon } from "@gdud/ui";

/** What the client flows need to know about a soldier. */
export interface PickPerson {
  id: string;
  name: string;
  personalNumber: string | null;
  place: string;
  /** extra searchable text, e.g. the serials the soldier holds */
  keywords?: string;
  /** small number on the right (e.g. items held) */
  badge?: number;
}

/** Search box + up to 10 matches. */
export function PersonPicker({
  people,
  onPick,
  placeholder = "חיפוש חייל לפי שם / מס׳ אישי",
  empty,
  autoFocus,
}: {
  people: PickPerson[];
  onPick: (id: string, query: string) => void;
  placeholder?: string;
  empty?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(
    () => (q.trim().length < 2 ? [] : people.filter((p) => matches(q, p.name, p.personalNumber, p.keywords)).slice(0, 10)),
    [people, q],
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="tz-search">
        <Icon name="search" size={15} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" autoFocus={autoFocus} />
      </label>
      {hits.length ? (
        <div className="tz-group border border-separator">
          {hits.map((p) => (
            <button key={p.id} type="button" className="tz-row" onClick={() => onPick(p.id, q)}>
              <Avatar name={p.name} size={30} />
              <span className="tz-row-body min-h-12 py-1.5">
                <span className="tz-row-title text-[14px]">
                  {p.name}
                  <span className="tz-row-sub text-xs">{[p.place, p.personalNumber].filter(Boolean).join(" · ") || "ללא שיבוץ"}</span>
                </span>
                {p.badge !== undefined ? <span className="tz-chip tz-chip-signed">{p.badge}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : q.trim().length >= 2 ? (
        <div className="tz-footnote px-1">{empty ?? "לא נמצא"}</div>
      ) : null}
    </div>
  );
}

/** The chosen soldier with a "שינוי" button. */
export function PickedPerson({ person, onClear }: { person: PickPerson; onClear: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-control bg-ground p-3">
      <Avatar name={person.name} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] font-semibold">{person.name}</span>
        <span className="tz-footnote truncate">
          {[person.place, person.personalNumber ? `מ.א ${person.personalNumber}` : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Button type="button" variant="plain" small onClick={onClear}>
        שינוי
      </Button>
    </div>
  );
}
