"use client";
import { useMemo, useState } from "react";
import { matches } from "@gdud/core";
import { Button, Field, Icon, Serial } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import { PersonPicker, PickedPerson, type PickPerson } from "@/components/person-picker";
import { signInternal } from "../_actions/register";

export type GearDept = "logistics" | "kesher" | "company";
export const GEAR_DEPT_LABEL: Record<GearDept, string> = { logistics: "לוגיסטיקה", kesher: "קשר", company: "פריטי פלוגה" };

export interface GearOption {
  /** "kind:id" */
  value: string;
  dept: GearDept;
  name: string;
  serial: string | null;
  category: string | null;
  /** "אצל דני כהן, מחלקה 1" / "בפלוגה" / "נשארו 3 מתוך 5" */
  where: string;
  /** a quantity item: how many are left; null = one piece */
  available: number | null;
}

/** How many suggestions the search shows. */
const MAX_HITS = 8;

/**
 * חדש: pick the department, search the gear by צ׳ or name (suggestions show where each is now),
 * search the receiver by name, and for a quantity item say how many.
 */
export function SignForm({ unitId, gear, soldiers }: { unitId: string; gear: readonly GearOption[]; soldiers: PickPerson[] }) {
  const depts = (Object.keys(GEAR_DEPT_LABEL) as GearDept[]).filter((d) => gear.some((g) => g.dept === d));
  const [dept, setDept] = useState<GearDept>(depts[0] ?? "logistics");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<GearOption | null>(null);
  const [to, setTo] = useState<PickPerson | null>(null);

  const hits = useMemo(() => {
    if (!q.trim()) return [];
    return gear.filter((g) => g.dept === dept && matches(q, g.serial, g.name, g.category)).slice(0, MAX_HITS);
  }, [gear, dept, q]);

  return (
    <ActionForm action={signInternal} submitLabel="רישום החתמה">
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="gear" value={picked?.value ?? ""} />
      <input type="hidden" name="to" value={to?.id ?? ""} />

      <Field label="מחלקה">
        <div className="tz-seg" role="tablist" aria-label="מחלקה">
          {depts.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={dept === d}
              className="tz-seg-item"
              onClick={() => {
                setDept(d);
                setPicked(null);
                setQ("");
              }}
            >
              {GEAR_DEPT_LABEL[d]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="ציוד">
        {picked ? (
          <div className="flex items-center gap-3 rounded-control bg-ground p-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">
                {picked.name} {picked.serial ? <Serial>{picked.serial}</Serial> : null}
              </span>
              <span className="tz-footnote truncate">{picked.where}</span>
            </span>
            <Button type="button" variant="plain" small onClick={() => setPicked(null)}>
              שינוי
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="tz-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`צ׳ או שם פריט — ${GEAR_DEPT_LABEL[dept]}`}
                aria-label="חיפוש ציוד לפי צ׳ או שם"
                autoComplete="off"
              />
            </label>
            {hits.length ? (
              <div className="tz-group border border-separator" role="listbox" aria-label="ציוד מתאים">
                {hits.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="tz-row"
                    disabled={g.available === 0}
                    onClick={() => setPicked(g)}
                  >
                    <span className="tz-row-body min-h-12 py-1.5">
                      <span className="tz-row-title text-[14px]">
                        {g.name} {g.serial ? <Serial>{g.serial}</Serial> : null}
                        <span className="tz-row-sub text-xs">{g.where}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : q.trim() ? (
              <div className="tz-footnote px-1">לא נמצא ציוד של {GEAR_DEPT_LABEL[dept]} שמתאים לחיפוש.</div>
            ) : null}
          </div>
        )}
      </Field>

      <Field label="מי מקבל">
        {to ? (
          <PickedPerson person={to} onClear={() => setTo(null)} />
        ) : (
          <PersonPicker people={soldiers} onPick={(id) => setTo(soldiers.find((p) => p.id === id) ?? null)} placeholder="חיפוש חייל בפלוגה לפי שם" />
        )}
      </Field>

      {picked?.available != null ? (
        <Field label={`כמות (נשארו ${picked.available})`}>
          <input name="quantity" type="number" className="tz-input tz-num" min={1} max={picked.available} defaultValue={1} required />
        </Field>
      ) : null}
      <p className="tz-footnote m-0">
        ההחתמה נרשמת מיד. אם הציוד כבר אצל מישהו בפלוגה, ההחתמה הקודמת שלו נסגרת. לא נרשם דבר בלוגיסטיקה או במחלקת קשר.
      </p>
    </ActionForm>
  );
}
