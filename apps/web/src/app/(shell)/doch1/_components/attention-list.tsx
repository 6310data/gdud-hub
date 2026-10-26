import Link from "next/link";
import { Icon } from "@gdud/ui";

export interface MissingByCompany {
  unitId: string;
  name: string;
  people: Array<{ personId: string; name: string; platoonName: string | null }>;
}

const NAMES_SHOWN = 4;

/** "דורש טיפול היום" (mockup 01 / 06): who has no status today, per company, each row opens the company's report. */
export function AttentionList({ items, when, dayQuery }: { items: MissingByCompany[]; when: string; dayQuery: string }) {
  const total = items.reduce((n, x) => n + x.people.length, 0);
  if (!total) {
    return (
      <div className="tz-group">
        <div className="tz-row">
          <span className="tz-tile" style={{ background: "var(--tile-ok)" }}>
            <Icon name="check" size={17} />
          </span>
          <span className="tz-row-body">
            <span className="tz-row-title">
              כל הפלוגות דיווחו {when}
              <span className="tz-row-sub">אין חיילים ברשימה בלי סטטוס</span>
            </span>
          </span>
        </div>
      </div>
    );
  }
  const sorted = [...items].sort((a, b) => b.people.length - a.people.length);
  return (
    <div className="tz-group">
      <div className="tz-row">
        <span className="tz-tile" style={{ background: "var(--tile-document)" }}>
          <Icon name="alert" size={17} />
        </span>
        <span className="tz-row-body">
          <span className="tz-row-title">
            ברשימה ואין להם סטטוס {when}
            <span className="tz-row-sub">{sorted.map((x) => `${x.name} ${x.people.length}`).join(" · ")}</span>
          </span>
          <span className="tz-row-value tz-num font-semibold" style={{ color: "var(--danger)" }}>
            {total}
          </span>
        </span>
      </div>
      {sorted.map((x) => (
        <Link key={x.unitId} href={`/doch1/today?unit=${x.unitId}${dayQuery}`} className="tz-row">
          <span className="tz-tile" style={{ background: "var(--tile-neutral)" }}>
            <Icon name="people" size={17} />
          </span>
          <span className="tz-row-body">
            <span className="tz-row-title">
              {x.name}
              <span className="tz-row-sub truncate">
                {x.people
                  .slice(0, NAMES_SHOWN)
                  .map((p) => p.name)
                  .join(", ")}
                {x.people.length > NAMES_SHOWN ? ` ועוד ${x.people.length - NAMES_SHOWN}` : ""}
              </span>
            </span>
            <span className="tz-row-value tz-num">{x.people.length}</span>
            <Icon name="chevron" size={17} className="tz-chevron" />
          </span>
        </Link>
      ))}
    </div>
  );
}
