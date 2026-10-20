/** Battalion structure: גדוד → פלוגה → מחלקה → צוות. */
export const UNIT_KINDS = ["battalion", "company", "platoon", "team"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_KIND_LABEL: Record<UnitKind, string> = {
  battalion: "גדוד",
  company: "פלוגה",
  platoon: "מחלקה",
  team: "צוות",
};

export interface UnitNode {
  id: string;
  parentId: string | null;
  kind: UnitKind;
  name: string;
  code: string | null;
  color: string | null;
  sortOrder: number;
  active: boolean;
}

/** parentId lookup used by permission checks. */
export type UnitParents = ReadonlyMap<string, string | null>;

export function toParentMap(units: readonly Pick<UnitNode, "id" | "parentId">[]): UnitParents {
  return new Map(units.map((u) => [u.id, u.parentId]));
}

/** The unit itself followed by its ancestors, root last. Cycle-safe. */
export function lineage(unitId: string, parents: UnitParents): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = unitId;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parents.get(cur);
  }
  return out;
}

/** Units sorted as a tree (parents before children, siblings by sortOrder/name), with depth. */
export function sortAsTree<T extends UnitNode>(units: readonly T[]): Array<T & { depth: number }> {
  const children = new Map<string | null, T[]>();
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    const list = children.get(key) ?? [];
    list.push(u);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he"));
  }
  const out: Array<T & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of children.get(parent) ?? []) {
      out.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
