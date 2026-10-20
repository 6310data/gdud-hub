/** Small presentational pieces shared by the logistics screens (server-safe, no hooks). */
import Link from "next/link";
import type { ReactNode } from "react";
import { CONDITION_LABEL, type Condition } from "@gdud/core";
import { Avatar, Chip, Icon, type IconName } from "@gdud/ui";

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-[220px] flex-1 flex-col">
        <h1 className="tz-title">{title}</h1>
        {sub ? <span className="tz-footnote">{sub}</span> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled white card, the building block of the desktop screens. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      {title || action ? (
        <div className="flex items-baseline justify-between gap-2 px-1">
          {title ? <h2 className="tz-panel-title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={`tz-card overflow-hidden ${bodyClassName ?? ""}`}>{children}</div>
    </section>
  );
}

const TONE = { ok: "ok", broken: "broken", brigade: "brigade" } as const;

/** "חתום" when signed out, else the armory condition. */
export function SerialChip({ condition, held }: { condition: Condition; held: boolean }) {
  return held ? <Chip tone="signed">חתום</Chip> : <Chip tone={TONE[condition]}>{CONDITION_LABEL[condition]}</Chip>;
}

export const CONDITION_TILE: Record<Condition, { color: string; icon: IconName }> = {
  ok: { color: "var(--tile-ok)", icon: "box" },
  broken: { color: "var(--tile-broken)", icon: "wrench" },
  brigade: { color: "var(--tile-brigade)", icon: "flag" },
};

export function SmallTile({ color, icon, size = 30 }: { color: string; icon: IconName; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center text-white"
      style={{ width: size, height: size, borderRadius: size > 24 ? 7 : 6, background: color }}
    >
      <Icon name={icon} size={size > 24 ? 17 : 13} />
    </span>
  );
}

export function Kpi({ href, value, label, tile }: { href?: string; value: ReactNode; label: ReactNode; tile?: ReactNode }) {
  const body = (
    <>
      {tile}
      <span>
        <span className="tz-kpi-value tz-num">{value}</span>
        <span className="tz-kpi-label">{label}</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="tz-kpi">
      {body}
    </Link>
  ) : (
    <div className="tz-kpi">{body}</div>
  );
}

export function PersonBadge({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{name}</span>
        {sub ? <span className="tz-footnote truncate">{sub}</span> : null}
      </span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-6 text-center text-[15px] text-ink-muted">{children}</div>;
}

/** Numbers that are 0 are dimmed in tables. */
export function NumCell({ n, strong }: { n: number; strong?: boolean }) {
  return <td className={`tz-num ${n ? "" : "tz-zero"} ${strong ? "font-semibold" : ""}`}>{n.toLocaleString("he-IL")}</td>;
}

/** Builds "?a=1&b=2" from the current params with some changed (undefined/null/"" removes a key). */
export function withParams(base: string, current: Record<string, string | undefined>, changes: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
