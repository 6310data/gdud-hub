import type { ReactNode } from "react";

/** One iOS-style settings row: the label on the start side, the control on the end side (mockup 05). */
export function SettingRow({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <label className="tz-row">
      <span className="tz-row-body flex-wrap gap-x-3">
        <span className="tz-row-title min-w-[160px]">
          {label}
          {sub ? <span className="tz-row-sub">{sub}</span> : null}
        </span>
        {children}
      </span>
    </label>
  );
}
