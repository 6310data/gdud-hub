"use client";
/** הגדרות מחלקת קשר: one form, "שמירה" → saveSettings. */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Spinner } from "@gdud/ui";
import { PushToggle } from "../../../doch1/_components/push-toggle";
import { saveSettings, type KesherSettingsInput } from "../../_actions/settings";

const TOAST_MS = 4000;
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00–22:00
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** "" / not a whole number → NaN (the action says what is wrong) */
const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

export function SettingsForm({ initial }: { initial: KesherSettingsInput }) {
  const router = useRouter();
  const [stale, setStale] = useState(String(initial.checkStaleDays));
  const [warn, setWarn] = useState(String(initial.eyeWarnDays));
  const [alert, setAlert] = useState(String(initial.eyeAlertDays));
  const [notifyMissing, setNotifyMissing] = useState(initial.notifyMissing);
  const [hour, setHour] = useState(initial.reminderHour === null ? "" : String(initial.reminderHour));
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const r = await saveSettings({
        checkStaleDays: num(stale),
        eyeWarnDays: num(warn),
        eyeAlertDays: num(alert),
        notifyMissing,
        reminderHour: hour === "" ? null : Number(hour),
      });
      if (!r.ok) return setError(r.error);
      setToast("ההגדרות נשמרו");
      router.refresh();
    });
  }

  // an hour saved before (outside 06–22) stays selectable
  const hours = initial.reminderHour !== null && !HOURS.includes(initial.reminderHour) ? [initial.reminderHour, ...HOURS] : HOURS;
  const warnN = num(warn);
  const alertN = num(alert);

  return (
    <form onSubmit={save} className="flex max-w-[860px] flex-col gap-6">
      <Section title="דוחות צ׳ וצהוב בעיניים">
        <div className="tz-card flex flex-col gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <DaysField label="דוח צ׳ נחשב ישן אחרי" value={stale} onChange={setStale} />
            <DaysField label="צהוב אחרי" value={warn} onChange={setWarn} />
            <DaysField label="אדום אחרי" value={alert} onChange={setAlert} />
          </div>
          <p className="tz-footnote m-0">
            בטבלת הצ׳ ובצהוב בעיניים, בדיקה (דוח צ׳ של הפלוגה או צהוב בעיניים) שעברו ממנה יותר מ־
            <span className="tz-num">{Number.isNaN(warnN) ? "…" : warnN}</span> ימים נצבעת בצהוב, ויותר מ־
            <span className="tz-num">{Number.isNaN(alertN) ? "…" : alertN}</span> ימים — באדום. דוח צ׳ של פלוגה שעברו ממנו יותר ימים מהמספר הראשון מסומן
            ״ישן״ בסקירה.
          </p>
        </div>
      </Section>

      <Section title="התראות">
        <div className="tz-group">
          <label className="tz-row cursor-pointer">
            <span className="tz-row-body">
              <span className="tz-row-title">
                התראה על צ׳ שלא נמצאו
                <span className="tz-row-sub">כשדוח צ׳ לא מצא צ׳, מנהלי הקשר הגדודיים מקבלים התראה: שם הפלוגה וכמה לא נמצאו.</span>
              </span>
              <input type="checkbox" role="switch" checked={notifyMissing} onChange={(e) => setNotifyMissing(e.target.checked)} aria-label="התראה על צ׳ שלא נמצאו" />
            </span>
          </label>
          <label className="tz-row">
            <span className="tz-row-body">
              <span className="tz-row-title">
                תזכורת יומית לפלוגות
                <span className="tz-row-sub">פעם ביום, בשעה הזו: משתמשי הקשר של פלוגה שלא הגישה דוח צ׳, או שהדוח האחרון שלה ישן, מקבלים תזכורת.</span>
              </span>
              <select className="tz-input w-[120px] flex-none" value={hour} onChange={(e) => setHour(e.target.value)} aria-label="שעת התזכורת היומית">
                <option value="">כבויה</option>
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {/* hidden when this browser can't get push (the toggle renders nothing) */}
          <div className="hidden has-[button]:block has-[p]:block">
            <div className="tz-row">
              <span className="tz-row-body">
                <span className="tz-row-title">
                  התראות במכשיר הזה
                  <span className="tz-row-sub">ההתראות מגיעות רק לדפדפנים ולטלפונים שהופעלו בהם.</span>
                </span>
                <PushToggle />
              </span>
            </div>
          </div>
        </div>
      </Section>

      {error ? (
        <p role="alert" className="tz-alert tz-alert-error m-0">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="tz-btn tz-btn-filled" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner size={14} /> : null}
          שמירה
        </button>
      </div>

      {toast ? (
        <div className="tz-toast lg:bottom-6" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-4 pb-1 text-[20px] font-bold leading-[26px]">{title}</h2>
      {children}
    </section>
  );
}

function DaysField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="tz-field">
      <span className="tz-label">{label}</span>
      <span className="flex items-center gap-2">
        <input className="tz-input w-[96px]" type="number" inputMode="numeric" min={1} max={90} step={1} value={value} onChange={(e) => onChange(e.target.value)} required />
        <span className="text-[15px]">ימים</span>
      </span>
    </label>
  );
}
