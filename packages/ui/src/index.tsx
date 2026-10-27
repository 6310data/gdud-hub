/**
 * Tzelem React components — thin wrappers over the tz- classes in tzelem.css.
 * Server-component safe (no hooks); interactive pieces live in the app.
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ElementType, ReactNode } from "react";

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
  | "tree"
  | "search"
  | "pencil"
  | "undo"
  | "refresh"
  | "wrench"
  | "flag"
  | "clock"
  | "table"
  | "archive"
  | "check"
  | "close"
  | "phone"
  | "doc"
  | "swap"
  | "trash"
  | "alert"
  | "minus"
  | "print"
  | "logo"
  | "grid"
  | "calendar"
  | "pin"
  | "send"
  | "more"
  | "upload"
  | "contact"
  | "report"
  | "apps"
  | "bell";

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
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </>
  ),
  undo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3.7 17.3a1.4 1.4 0 0 0 2 2l5.7-5.7a4 4 0 0 0 5.3-5.3l-2.5 2.5-2-.5-.5-2z" />,
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M9 4v16" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  phone: <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z" />,
  doc: (
    <>
      <path d="M7 3h7l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-10A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3z" />
      <path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4L3 8l4 4M3 8h14" />
      <path d="M17 20l4-4-4-4M21 16H7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 7V4.5h4V7" />
      <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4.5M12 18v.01" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  print: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  logo: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  send: (
    <>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3l-6.5 18-4-7.5-7.5-4z" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  contact: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7.5 17c.9-2 2.5-3 4.5-3s3.6 1 4.5 3" />
    </>
  ),
  report: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
      <path d="M8.3 10.5l2.2 2.2 4.6-4.6M8.3 16.5h7.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  apps: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <path d="M17 14v6M14 17h6" />
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

/* ── Loading ── */
export function Spinner({ size, label }: { size?: number; label?: string }) {
  const style = size ? { width: size, height: size } : undefined;
  return label ? (
    <span className="tz-spinner" role="status" aria-label={label} style={style} />
  ) : (
    <span className="tz-spinner" aria-hidden="true" style={style} />
  );
}

/** A grey shimmering block that stands in for content while it loads. */
export function Skeleton({ height, width, className }: { height: number | string; width?: number | string; className?: string }) {
  return <span className={cx("tz-skeleton", className)} style={{ height, width }} aria-hidden="true" />;
}

/* ── Buttons ── */
type BtnVariant = "filled" | "tinted" | "plain" | "danger";
/** `loading` disables the button and shows a spinner before the label. */
export function Button({
  variant = "filled",
  small,
  loading,
  className,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean; loading?: boolean }) {
  return (
    <button
      className={cx("tz-btn", `tz-btn-${variant}`, small && "tz-btn-sm", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={small ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

/* ── Steps of a long process ── */
/** active = working on it now (spinner); current = the step the user is on */
export type StepState = "done" | "active" | "current" | "waiting" | "error";
export interface StepItem {
  id: string;
  label: ReactNode;
  state: StepState;
  detail?: ReactNode;
  /** 0–1, shown as a bar under an active step */
  progress?: number;
}

export function Steps({ steps, label, row }: { steps: readonly StepItem[]; label?: string; row?: boolean }) {
  return (
    <ol className="tz-steps" data-layout={row ? "row" : undefined} aria-label={label}>
      {steps.map((st, i) => (
        <li key={st.id} data-state={st.state} aria-current={st.state === "active" || st.state === "current" ? "step" : undefined}>
          <span className="tz-step-mark">
            {st.state === "done" ? (
              <Icon name="check" size={15} />
            ) : st.state === "active" ? (
              <Spinner />
            ) : st.state === "error" ? (
              <Icon name="close" size={14} />
            ) : (
              i + 1
            )}
          </span>
          <span className="tz-step-body">
            <span>{st.label}</span>
            {st.detail ? <span className="tz-step-detail">{st.detail}</span> : null}
            {st.state === "active" && st.progress !== undefined ? (
              <span className="tz-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.progress * 100)}>
                <span style={{ width: `${Math.round(st.progress * 100)}%` }} />
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
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

export function Avatar({ name, size }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  return (
    <span className="tz-avatar" style={style}>
      {initials}
    </span>
  );
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
/** `.tz-tint` style for a company's table column or row: its color, lightened. No color → no tint. */
export function tintStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? ({ "--tint": color } as CSSProperties) : undefined;
}

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

/* ── StockBar: armory share of an item (signed = the empty track) ── */
export function StockBar({
  ok,
  broken,
  brigade,
  total,
  height = 6,
  label,
}: {
  ok: number;
  broken: number;
  brigade: number;
  total: number;
  height?: number;
  label?: string;
}) {
  const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  return (
    <span className="tz-bar" style={{ height }} role="img" aria-label={label ?? `${ok} תקין, ${broken} תקול, ${brigade} חטיבה מתוך ${total}`}>
      {ok ? <span className="ok" style={{ width: w(ok) }} /> : null}
      {broken ? <span className="broken" style={{ width: w(broken) }} /> : null}
      {brigade ? <span className="brigade" style={{ width: w(brigade) }} /> : null}
    </span>
  );
}
