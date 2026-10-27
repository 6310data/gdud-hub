"use client";
import { Icon } from "@gdud/ui";
import { ActionForm } from "@/components/action-form";
import type { FieldOptionField, FieldOptionVM } from "@/lib/doch1/data";
import { EFFECT_CHIP, FIELD_EFFECTS, FIELD_SUGGESTIONS } from "@/lib/doch1/format";
import { deleteFieldOption, saveFieldOption } from "../../_actions/settings";

export interface FieldOptionRow extends FieldOptionVM {
  /** soldiers of the round with this value */
  used: number;
}

const effectLabel = (field: FieldOptionField, effect: string) => FIELD_EFFECTS[field].find((e) => e.effect === effect)?.label ?? effect;

function OptionFields({ field, roundId, option, nextSort }: { field: FieldOptionField; roundId: string; option: FieldOptionRow | null; nextSort: number }) {
  return (
    <>
      {option ? <input type="hidden" name="id" value={option.id} /> : null}
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="field" value={field} />
      <span className="flex flex-wrap items-end gap-2">
        <label className="tz-field">
          <span className="tz-label">שם (כמו בגיליון)</span>
          <input className="tz-input min-h-9 w-[170px]" name="name" required maxLength={30} defaultValue={option?.name ?? ""} />
        </label>
        <label className="tz-field">
          <span className="tz-label">משמעות</span>
          <select className="tz-input min-h-9 w-[150px]" name="effect" defaultValue={option?.effect ?? FIELD_EFFECTS[field][0].effect}>
            {FIELD_EFFECTS[field].map((e) => (
              <option key={e.effect} value={e.effect}>
                {e.label} · {e.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="tz-field">
          <span className="tz-label">סדר</span>
          <input className="tz-input min-h-9 w-[72px]" type="number" name="sortOrder" min={0} max={999} defaultValue={option?.sortOrder ?? nextSort} />
        </label>
      </span>
    </>
  );
}

function OptionList({ field, title, roundId, options }: { field: FieldOptionField; title: string; roundId: string; options: FieldOptionRow[] }) {
  const nextSort = options.length ? Math.max(...options.map((o) => o.sortOrder)) + 1 : 0;
  const suggestions = FIELD_SUGGESTIONS[field];
  return (
    <>
      <h3 className="tz-section-header">{title}</h3>
      <div className="tz-group">
        {options.map((o) => {
          const others = options.filter((x) => x.id !== o.id);
          return (
            <details key={o.id} className="group border-b border-separator">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                <span className="tz-footnote">
                  <span className="tz-num">{o.used}</span> חיילים
                </span>
                <span className={`tz-chip ${EFFECT_CHIP[o.effect]}`}>{effectLabel(field, o.effect)}</span>
                <Icon name="chevron" size={17} className="tz-chevron transition-transform group-open:-rotate-90" />
              </summary>
              <div className="flex flex-col gap-3 bg-ground/60 px-4 pb-4 pt-2">
                <ActionForm action={saveFieldOption} submitLabel="שמירה" variant="tinted" className="flex flex-col items-start gap-3">
                  <OptionFields field={field} roundId={roundId} option={o} nextSort={nextSort} />
                </ActionForm>
                <ActionForm action={deleteFieldOption} submitLabel="מחיקת הערך" variant="danger" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  {o.used ? (
                    <label className="tz-field">
                      <span className="tz-label">{o.used} חיילים עם הערך הזה יקבלו במקומו</span>
                      <select className="tz-input min-h-9 w-[200px]" name="replacementId" defaultValue="">
                        <option value="">ריק (לא מולא)</option>
                        {others.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </ActionForm>
              </div>
            </details>
          );
        })}
        {!options.length ? (
          <div className="flex flex-col gap-2 border-b border-separator px-4 py-3">
            <span className="tz-footnote">הרשימה ריקה. ערכים מוצעים:</span>
            <span className="flex flex-wrap gap-2">
              {suggestions.map((x, i) => (
                <ActionForm key={x.name} action={saveFieldOption} submitLabel={`+ ${x.name}`} variant="plain" className="contents">
                  <input type="hidden" name="roundId" value={roundId} />
                  <input type="hidden" name="field" value={field} />
                  <input type="hidden" name="name" value={x.name} />
                  <input type="hidden" name="effect" value={x.effect} />
                  <input type="hidden" name="sortOrder" value={i} />
                </ActionForm>
              ))}
            </span>
          </div>
        ) : null}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <Icon name="plus" size={18} />
            הוספת ערך
          </summary>
          <ActionForm action={saveFieldOption} submitLabel="הוספת ערך" variant="filled" className="flex flex-col items-start gap-3 px-4 pb-4 pt-2">
            <OptionFields field={field} roundId={roundId} option={null} nextSort={nextSort} />
          </ActionForm>
        </details>
      </div>
    </>
  );
}

/** The two value lists of the round (sheet columns I and K). What a value does comes from its משמעות, never its name. */
export function FieldOptionsEditor({ roundId, options }: { roundId: string; options: FieldOptionRow[] }) {
  return (
    <>
      <OptionList field="arrival" title="צפי הגעה" roundId={roundId} options={options.filter((o) => o.field === "arrival")} />
      <p className="tz-section-footer">חייל עם ערך שמשמעותו ״לא מגיע״ לא מופיע באף יום של הסבב, באף ספירה ובאף תזכורת. ערך ריק נחשב מגיע.</p>
      <OptionList field="enlistment" title="סטטוס גיוס" roundId={roundId} options={options.filter((o) => o.field === "enlistment")} />
      <p className="tz-section-footer">במסך יום הגיוס: ״נדחה״ מבקש תאריך גיוס חדש, ״שוחרר״ מבקש תאריך שחרור, ״התייצב״ נספר באחוז ההתייצבות.</p>
    </>
  );
}
