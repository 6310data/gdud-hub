/**
 * Tzelem React components — thin wrappers over the tz- classes in tzelem.css.
 * Server-component safe (no hooks); interactive pieces live in the app.
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, ReactNode } from "react";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ── Icons: SF-Symbols-style line icons, 24px grid, currentColor ── */
export type IconName =
  | "home"
  | "gear"
  | "box"
  | "list"
  | "people"
  | "antenna"
  | "person"
  | "plus"
  | "chevron"
  | "logout"
  | "shield"
  | "tree";

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
      <circle cx="12" cy="12" r="7" />
    </>
  ),
  box: (
    <>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" />
      <path d="M4 7.5 12 11l8-3.5M12 11v9" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16.5 14c2.4.2 4 1.8 4.5 4.5" />
    </>
  ),
  antenna: (
    <>
      <path d="M12 11v9M9 20h6" />
      <circle cx="12" cy="9" r="1.6" />
      <path d="M8.5 5.5a5 5 0 0 0 0 7M15.5 5.5a5 5 0 0 1 0 7M6 3a8.5 8.5 0 0 0 0 12M18 3a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m14.5 6-6 6 6 6" />,
  logout: (
    <>
      <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </>
  ),
  shield: <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />,
  tree: (
    <>
      <rect x="9" y="3.5" width="6" height="4.5" rx="1" />
      <rect x="3.5" y="16" width="6" height="4.5" rx="1" />
      <rect x="14.5" y="16" width="6" height="4.5" rx="1" />
      <path d="M12 8v4M6.5 16v-4h11v4" />
    </>
  ),
};

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 20 ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/* ── Buttons ── */
type BtnVariant = "filled" | "tinted" | "plain" | "danger";
export function Button({
  variant = "filled",
  small,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean }) {
  return <button className={cx("tz-btn", `tz-btn-${variant}`, small && "tz-btn-sm", className)} {...rest} />;
}

/* ── Page title ── */
export function LargeTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header style={{ marginBlock: "8px 20px" }}>
      <h1 className="tz-large-title">{children}</h1>
      {sub ? <p className="tz-footnote" style={{ margin: "4px 0 0" }}>{sub}</p> : null}
    </header>
  );
}

/* ── Grouped list ── */
export function Section({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="tz-section">
      {header ? <h2 className="tz-section-header">{header}</h2> : null}
      <div className="tz-group">{children}</div>
      {footer ? <p className="tz-section-footer">{footer}</p> : null}
    </section>
  );
}

type TileColor = "primary" | "ok" | "broken" | "brigade" | "neutral" | "document";
const tileVar: Record<TileColor, string> = {
  primary: "var(--primary)",
  ok: "var(--tile-ok)",
  broken: "var(--tile-broken)",
  brigade: "var(--tile-brigade)",
  neutral: "var(--tile-neutral)",
  document: "var(--tile-document)",
};

export function Tile({ icon, color = "primary" }: { icon: IconName; color?: TileColor }) {
  return (
    <span className="tz-tile" style={{ background: tileVar[color] }}>
      <Icon name={icon} size={17} />
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return <span className="tz-avatar">{initials}</span>;
}

interface RowProps {
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}

function RowInner({ leading, title, sub, value, trailing, chevron }: RowProps) {
  return (
    <>
      {leading}
      <span className="tz-row-body">
        <span className="tz-row-title">
          {title}
          {sub ? <span className="tz-row-sub">{sub}</span> : null}
        </span>
        {value ? <span className="tz-row-value">{value}</span> : null}
        {trailing}
        {chevron ? <Icon name="chevron" size={17} className="tz-chevron" /> : null}
      </span>
    </>
  );
}

export function Row(props: RowProps) {
  return (
    <div className="tz-row">
      <RowInner {...props} />
    </div>
  );
}

/** A tappable row. Pass `as={Link}` (next/link) for client-side navigation. */
export function LinkRow({
  as: Comp = "a",
  leading,
  title,
  sub,
  value,
  trailing,
  chevron = true,
  ...a
}: RowProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; as?: ElementType }) {
  return (
    <Comp className="tz-row" {...a}>
      <RowInner {...{ leading, title, sub, value, trailing, chevron }} />
    </Comp>
  );
}

/* ── Chips ── */
export function Chip({ tone, children }: { tone: "ok" | "broken" | "brigade" | "signed" | "admin"; children: ReactNode }) {
  return <span className={`tz-chip tz-chip-${tone}`}>{children}</span>;
}

/* ── Serial / personal number / phone (always LTR, mono) ── */
export function Serial({ children }: { children: ReactNode }) {
  return <span className="tz-serial">{children}</span>;
}

/* ── Form field ── */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="tz-field">
      <span className="tz-label">{label}</span>
      {children}
    </label>
  );
}
