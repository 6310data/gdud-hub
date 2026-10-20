import Link from "next/link";
import { kitToString } from "@gdud/core";
import { withUser } from "@gdud/db";
import { Avatar, Icon, Serial } from "@gdud/ui";
import { loadPersonForms, personPlace, type HoldingVM, type PersonVM, type StoredVM } from "@/lib/logistics/data";
import { fmtDate, fmtDateTime } from "@/lib/logistics/format";
import { requireModule } from "@/lib/session";

/** כרטיס חייל — contact, actions, signed equipment, storage and forms. */
export async function PersonInspector({
  person,
  holdings,
  stored,
  canAdmin,
  canEdit,
  closeHref,
}: {
  person: PersonVM;
  holdings: HoldingVM[];
  stored: StoredVM[];
  canAdmin: boolean;
  canEdit: boolean;
  closeHref: string;
}) {
  const s = await requireModule("logistics");
  const forms = await withUser(s.claims, (tx) => loadPersonForms(tx, person.id));
  const storedSerials = new Set(stored.map((x) => x.serialId).filter(Boolean));

  return (
    <aside aria-label="כרטיס חייל" className="order-1 flex flex-col gap-3 lg:sticky lg:top-6 lg:order-2">
      <div className="tz-card relative flex flex-col items-center gap-1 p-4 text-center">
        <Link href={closeHref} scroll={false} className="tz-btn tz-btn-plain absolute end-2 top-2 min-h-0 p-1" aria-label="סגירת כרטיס החייל">
          <Icon name="close" size={18} />
        </Link>
        <Avatar name={person.name} size={64} />
        <span className="mt-1 text-[20px] font-bold">{person.name}</span>
        <span className="tz-footnote">{[personPlace(person), person.roleTitle].filter(Boolean).join(" · ") || "ללא שיבוץ"}</span>
        {!person.active ? <span className="tz-chip tz-chip-broken mt-1">הוסר מהאלפון</span> : null}
        <div className="mt-3 grid w-full grid-cols-3 gap-2">
          {person.phone ? (
            <a href={`tel:${person.phone}`} className="tz-btn tz-btn-tinted min-h-[52px] flex-col gap-0.5 px-1 text-[13px]">
              <Icon name="phone" size={18} />
              התקשרות
            </a>
          ) : (
            <span />
          )}
          {canAdmin && person.active ? (
            <Link href={`/logistics/sign?person=${person.id}`} className="tz-btn tz-btn-filled min-h-[52px] flex-col gap-0.5 px-1 text-[13px]">
              <Icon name="pencil" size={18} />
              החתמה
            </Link>
          ) : (
            <span />
          )}
          {canAdmin && holdings.length ? (
            <Link href={`/logistics/return?person=${person.id}`} className="tz-btn tz-btn-tinted min-h-[52px] flex-col gap-0.5 px-1 text-[13px]">
              <Icon name="undo" size={18} />
              זיכוי
            </Link>
          ) : (
            <span />
          )}
        </div>
      </div>

      <div className="tz-group">
        <InfoRow label="מספר אישי" value={person.personalNumber ? <Serial>{person.personalNumber}</Serial> : "—"} />
        <InfoRow label="טלפון" value={person.phone ? <a href={`tel:${person.phone}`} className="tz-serial text-primary no-underline">{person.phone}</a> : "—"} />
        {canEdit ? (
          <Link href={`/logistics/people/${person.id}/edit`} className="tz-row">
            <span className="tz-row-body">
              <span className="tz-row-title text-[14px] text-primary">עריכת פרטים</span>
              <Icon name="chevron" size={15} className="tz-chevron" />
            </span>
          </Link>
        ) : null}
      </div>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="tz-panel-title">ציוד מוחתם · {holdings.length}</h2>
          {holdings.length ? (
            <Link href={`/logistics/people/${person.id}/form`} className="text-[13px] font-semibold text-primary no-underline">
              טופס ציוד חתום
            </Link>
          ) : null}
        </div>
        <div className="tz-group">
          {holdings.length === 0 ? <div className="p-4 text-[14px] text-ink-muted">אין ציוד מוחתם</div> : null}
          {holdings.map((h) => (
            <Link key={h.id} href={`/logistics/serials/${h.serialId}`} className="tz-row">
              <span className="tz-row-body">
                <span className="tz-row-title text-[14px]">
                  {h.itemName}
                  {kitToString(h.kit) || h.notes ? <span className="tz-row-sub text-xs">{[kitToString(h.kit), h.notes].filter(Boolean).join(" · ")}</span> : null}
                </span>
                {storedSerials.has(h.serialId) ? <span className="tz-chip tz-chip-brigade">באפסון</span> : null}
                <Serial>{h.serial}</Serial>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {stored.length || (canAdmin && holdings.length) ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="tz-panel-title">באפסון · {stored.length}</h2>
            {canAdmin ? (
              <span className="flex gap-3">
                {holdings.length ? <Link href={`/logistics/storage/in?person=${person.id}`} className="text-[13px] font-semibold text-primary no-underline">אפסון</Link> : null}
                {stored.length ? <Link href={`/logistics/storage/out?person=${person.id}`} className="text-[13px] font-semibold text-primary no-underline">הוצאה</Link> : null}
              </span>
            ) : null}
          </div>
          <div className="tz-group">
            {stored.length === 0 ? <div className="p-4 text-[14px] text-ink-muted">אין פריטים באפסון</div> : null}
            {stored.map((x) => (
              <div key={x.id} className="tz-row">
                <span className="tz-row-body">
                  <span className="tz-row-title text-[14px]">
                    {x.itemName}
                    <span className="tz-row-sub text-xs">מ-{fmtDate(x.storedAt)}</span>
                  </span>
                  {x.serial ? <Serial>{x.serial}</Serial> : <span className="text-xs text-ink-muted">ללא צ׳</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <h2 className="tz-panel-title">טפסים</h2>
        <div className="tz-group">
          {forms.length === 0 ? <div className="p-4 text-[14px] text-ink-muted">אין טפסים</div> : null}
          {forms.map((f) => (
            <Link key={f.id} href={`/logistics/forms/${f.id}`} className="tz-row">
              <span className="tz-tile" style={{ background: "var(--tile-document)" }}>
                <Icon name="doc" size={16} />
              </span>
              <span className="tz-row-body">
                <span className="tz-row-title text-[14px]">
                  {f.kind === "holdings" ? "טופס ציוד חתום" : "טופס החתמה"}
                  <span className="tz-row-sub text-xs">{fmtDateTime(f.createdAt)}</span>
                </span>
                <span className="text-xs text-ink-muted">{f.data.lines.length} פריטים</span>
                <Icon name="chevron" size={15} className="tz-chevron" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="tz-row">
      <span className="tz-row-body min-h-11">
        <span className="tz-row-title text-[14px] text-ink-muted">{label}</span>
        <span className="text-[15px]">{value}</span>
      </span>
    </div>
  );
}
