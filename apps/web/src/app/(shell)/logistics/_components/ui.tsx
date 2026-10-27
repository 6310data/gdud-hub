/** Small presentational pieces shared by the logistics screens (server-safe, no hooks). */
import { CONDITION_LABEL, type Condition } from "@gdud/core";
import { Chip, tintStyle, type IconName } from "@gdud/ui";

export { Empty, Kpi, PageHeader, Panel, PersonBadge, SmallTile, withParams } from "@/components/page-parts";

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

/** A count cell; `tint` = the company's color, for a company's column (see .tz-tint). */
export function NumCell({ n, strong, tint }: { n: number; strong?: boolean; tint?: string | null }) {
  return (
    <td className={`tz-num ${n ? "" : "tz-zero"} ${strong ? "font-semibold" : ""} ${tint ? "tz-tint" : ""}`} style={tintStyle(tint)}>
      {n.toLocaleString("he-IL")}
    </td>
  );
}

