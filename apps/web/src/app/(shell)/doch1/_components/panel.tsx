import type { ReactNode } from "react";

/** A titled white card, the building block of the desktop screens (as in logistics). */
export function Panel({
  title,
  action,
  footer,
  children,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      {title || action ? (
        <div className="flex items-baseline justify-between gap-2 px-1">
          {title ? <h2 className="tz-panel-title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={`tz-card overflow-hidden ${bodyClassName ?? ""}`}>{children}</div>
      {footer ? <p className="tz-section-footer">{footer}</p> : null}
    </section>
  );
}
