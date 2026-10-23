/**
 * A day status as a chip. Status colors are data from settings, so they come in as inline
 * styles (tinted background, colored text); "missing" uses the Tzelem danger tokens.
 */
export function StatusChip({ status }: { status: { name: string; color: string } | null | undefined }) {
  if (!status) {
    return (
      <span className="tz-chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
        חסר
      </span>
    );
  }
  return (
    <span className="tz-chip" style={{ background: `color-mix(in srgb, ${status.color} 14%, white)`, color: status.color }}>
      {status.name}
    </span>
  );
}

/** A small colored dot (status pickers, legends). */
export function StatusDot({ color, size = 12 }: { color: string; size?: number }) {
  return <span aria-hidden="true" className="flex-none rounded-full" style={{ width: size, height: size, background: color }} />;
}
