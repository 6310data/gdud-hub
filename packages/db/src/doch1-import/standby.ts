/**
 * The שבצ״ק part of the round-sheet import: each "שבצק <company>" tab gives every soldier's
 * location, their standby team (כוננות) and role, and the team's vehicle (צ כלי).
 *
 *   tab → company        the company of the day tab with the same name (no question of its own)
 *   מיקום → location     by name; an unknown one is a mapping question (create as a kind, map, or ignore)
 *   כוננות → team        one per company and name: an existing team of the round held by that
 *                        company with the same name, else a new one held by it
 *
 * Overwritten from the sheet: the locations of the file's soldiers (a soldier of an imported
 * company who is in no שבצ״ק has none); the team of every soldier the שבצ״ק lists (לא בכוננות =
 * none); the members and roles of the sheet's teams; their vehicle when the sheet gives one.
 * Teams that exist only in the app keep their soldiers who are not in any שבצ״ק.
 */
import { canonicalName, type LocationKind } from "@gdud/core";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { suggestLocationKind, type ParsedSheet } from "./parse";

const { doch1Locations, doch1Vehicles, doch1StandbyTypes, doch1StandbyTeams, doch1StandbyHolders, doch1StandbyMembers } = schema;

/** An answer to a location question: an existing location id, a new location of a kind, or "ignore". */
export type LocationAnswer = string;
export const createLocation = (kind: LocationKind) => `create:${kind}` as const;
const CREATE_PREFIX = "create:";

export interface StandbyEntry {
  personalNumber: string;
  tabName: string;
  /** the company whose שבצ״ק lists the soldier (holds their team) */
  companyId: string;
  location: string;
  team: string;
  vehicle: string;
  role: string;
  /** position in the file (tab order, then row), for the team's member order */
  order: number;
}

export interface StandbyResolution {
  /** companies whose שבצ״ק tab is imported */
  companies: Set<string>;
  /** by personal number; only soldiers that are in the file's company tabs */
  entries: Map<string, StandbyEntry>;
  /** location key → location id, `create:<kind>`, or null (ignore); only answered keys */
  locationMap: Map<string, string | null>;
  /** location key → the text as written */
  locationText: Map<string, string>;
  locations: Array<typeof doch1Locations.$inferSelect>;
  vehicles: Map<string, string>;
  types: Array<typeof doch1StandbyTypes.$inferSelect>;
  teams: Array<typeof doch1StandbyTeams.$inferSelect & { holderIds: string[] }>;
  teamMembers: Array<typeof doch1StandbyMembers.$inferSelect>;
}

/** A mapping question about a שבצ״ק location (the shape of MappingQuestion in plan.ts). */
export interface LocationQuestion {
  kind: "location";
  key: string;
  label: string;
  suggestion: string;
  options: Array<{ id: string; label: string }>;
}

export async function resolveStandby(
  tx: Tx,
  roundId: string,
  parsed: ParsedSheet,
  ctx: {
    /** day-tab key → company id (or null = ignored); only answered tabs */
    tabMap: ReadonlyMap<string, string | null>;
    /** personal numbers of the soldiers the import keeps, with their company */
    chosen: ReadonlyMap<string, string>;
    companyByKey: ReadonlyMap<string, string>;
    isActive: (companyId: string) => boolean;
    given: Readonly<Record<string, LocationAnswer>> | undefined;
    saved: ReadonlyMap<string, string | null>;
    ask: (q: LocationQuestion) => void;
    warnings: string[];
  },
): Promise<StandbyResolution> {
  const [locations, vehicles, types, teams] = await Promise.all([
    tx.select().from(doch1Locations).where(eq(doch1Locations.roundId, roundId)),
    tx.select({ id: doch1Vehicles.id, number: doch1Vehicles.number }).from(doch1Vehicles),
    tx.select().from(doch1StandbyTypes).where(eq(doch1StandbyTypes.roundId, roundId)),
    tx.select().from(doch1StandbyTeams).where(eq(doch1StandbyTeams.roundId, roundId)),
  ]);
  const teamIds = teams.map((t) => t.id);
  const [holders, teamMembers] = teamIds.length
    ? await Promise.all([
        tx.select().from(doch1StandbyHolders).where(inArray(doch1StandbyHolders.teamId, teamIds)),
        tx.select().from(doch1StandbyMembers).where(eq(doch1StandbyMembers.roundId, roundId)),
      ])
    : [[], []];

  /* tabs → companies */
  const companies = new Set<string>();
  const entries = new Map<string, StandbyEntry>();
  let order = 0;
  for (const tab of parsed.standby) {
    const mapped = ctx.tabMap.get(tab.companyKey);
    if (mapped === null) {
      ctx.warnings.push(`${tab.tabName}: לשונית הפלוגה מסומנת ״להתעלם״ — השבצ״ק לא יובא`);
      continue;
    }
    const companyId = mapped ?? ctx.companyByKey.get(tab.companyKey);
    if (!companyId) {
      // an open question about the company tab: the next preview resolves it
      if (!parsed.tabs.some((t) => t.key === tab.companyKey)) ctx.warnings.push(`${tab.tabName}: לא נמצאה פלוגה בשם הזה — השבצ״ק לא יובא`);
      continue;
    }
    if (!ctx.isActive(companyId)) {
      ctx.warnings.push(`${tab.tabName}: הפלוגה לא פעילה בסבב — השבצ״ק לא יובא`);
      continue;
    }
    companies.add(companyId);
    let outside = 0;
    for (const row of tab.rows) {
      order++;
      if (!ctx.chosen.has(row.personalNumber)) {
        outside++;
        continue;
      }
      const entry: StandbyEntry = { personalNumber: row.personalNumber, tabName: tab.tabName, companyId, location: row.location, team: row.team, vehicle: row.vehicle, role: row.role, order };
      const prev = entries.get(row.personalNumber);
      // as the sheet's גדודי tab does: the first row that says something wins
      if (prev && (prev.location || prev.team)) {
        if (entry.location || entry.team) ctx.warnings.push(`${row.personalNumber} מופיע בשבצ״ק של ${prev.tabName} ושל ${tab.tabName} — נלקח ${prev.tabName}`);
        continue;
      }
      entries.set(row.personalNumber, entry);
    }
    if (outside) ctx.warnings.push(`${tab.tabName}: ${outside} חיילים בשבצ״ק שאינם בלשוניות הפלוגות — לא שובצו`);
  }

  /* locations */
  const locationMap = new Map<string, string | null>();
  const locationText = new Map<string, string>();
  const byId = new Map(locations.map((l) => [l.id, l]));
  const valid = (a: string | null | undefined): a is string =>
    !!a && (a === "ignore" || byId.has(a) || (a.startsWith(CREATE_PREFIX) && ["outpost", "camp", "outside"].includes(a.slice(CREATE_PREFIX.length))));
  for (const e of entries.values()) {
    if (!e.location) continue;
    const key = canonicalName(e.location);
    if (locationText.has(key)) continue;
    locationText.set(key, e.location);
    const given = ctx.given?.[key];
    const saved = ctx.saved.get(key);
    const auto = locations.find((l) => canonicalName(l.name) === key)?.id;
    const answer = valid(given) ? given : saved === null ? "ignore" : saved && byId.has(saved) ? saved : auto;
    if (answer === undefined) {
      ctx.ask({
        kind: "location",
        key,
        label: e.location,
        suggestion: createLocation(suggestLocationKind(e.location)),
        options: locations.filter((l) => l.active).map((l) => ({ id: l.id, label: l.name })),
      });
      continue;
    }
    locationMap.set(key, answer === "ignore" ? null : answer);
  }

  return {
    companies,
    entries,
    locationMap,
    locationText,
    locations,
    vehicles: new Map(vehicles.map((v) => [v.number, v.id])),
    types,
    teams: teams.map((t) => ({ ...t, holderIds: holders.filter((h) => h.teamId === t.id).map((h) => h.unitId) })),
    teamMembers,
  };
}

/* ── the changes ── */

export interface NewTeam {
  /** `${companyId}|${canonical name}` */
  key: string;
  name: string;
  companyId: string;
  typeId: string | null;
  /** a location id, `new:<key>` for a location the import creates, or null */
  locationId: string | null;
  vehicle: string | null;
}

export interface StandbyChanges {
  newLocations: Array<{ key: string; name: string; kind: LocationKind }>;
  /** soldiers whose location changes; locationId may be `new:<key>` */
  locate: Array<{ personId: string; locationId: string | null }>;
  newVehicles: string[];
  newTeams: NewTeam[];
  /** teamId may be `new:<team key>` */
  addMembers: Array<{ teamId: string; personId: string; role: string | null; sortOrder: number }>;
  removeMembers: Array<{ teamId: string; personId: string }>;
  roleUpdates: Array<{ teamId: string; personId: string; role: string | null }>;
  /** existing teams whose vehicle the sheet changes */
  teamVehicles: Array<{ teamId: string; vehicle: string }>;
}

export const newLocationId = (key: string) => `new:${key}`;
export const newTeamId = (key: string) => `new:${key}`;

function mostCommon(values: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, c] of n) if (best === null || c > n.get(best)!) best = v;
  return best;
}

/**
 * What the import changes in the שבצ״ק.
 * @param chosen the file's soldiers: personal number → their company
 * @param personOf personal number → person id (`new:<pn>` for people the import creates)
 * @param memberLocation person id → their current location (undefined = not a member yet)
 */
export function standbyChanges(
  sb: StandbyResolution,
  chosen: ReadonlyMap<string, string>,
  personOf: (personalNumber: string) => string,
  memberLocation: (personId: string) => string | null | undefined,
): StandbyChanges {
  const out: StandbyChanges = { newLocations: [], locate: [], newVehicles: [], newTeams: [], addMembers: [], removeMembers: [], roleUpdates: [], teamVehicles: [] };

  /* locations */
  for (const [key, target] of sb.locationMap) {
    if (target?.startsWith(CREATE_PREFIX)) out.newLocations.push({ key, name: sb.locationText.get(key)!, kind: target.slice(CREATE_PREFIX.length) as LocationKind });
  }
  /** undefined = an open question: leave the soldier as is */
  const locationOf = (text: string): string | null | undefined => {
    if (!text) return null;
    const key = canonicalName(text);
    if (!sb.locationMap.has(key)) return undefined;
    const target = sb.locationMap.get(key)!;
    return target?.startsWith(CREATE_PREFIX) ? newLocationId(key) : target;
  };
  for (const [pn, companyId] of chosen) {
    const entry = sb.entries.get(pn);
    if (!entry && !sb.companies.has(companyId)) continue;
    const want = entry ? locationOf(entry.location) : null;
    if (want === undefined) continue;
    const personId = personOf(pn);
    if ((memberLocation(personId) ?? null) !== want) out.locate.push({ personId, locationId: want });
  }

  /* teams of the sheet, in file order */
  const groups = new Map<string, StandbyEntry[]>();
  for (const e of [...sb.entries.values()].sort((a, b) => a.order - b.order)) {
    if (!e.team) continue;
    const key = `${e.companyId}|${canonicalName(e.team)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const knownVehicles = new Set(sb.vehicles.keys());
  const needVehicle = (v: string) => {
    if (!knownVehicles.has(v)) {
      knownVehicles.add(v);
      out.newVehicles.push(v);
    }
  };
  const vehicleNumber = new Map([...sb.vehicles].map(([number, id]) => [id, number]));
  const current = new Map(sb.teamMembers.map((m) => [m.personId, m]));

  for (const [key, list] of groups) {
    const companyId = list[0]!.companyId;
    const canon = key.slice(companyId.length + 1);
    const team = sb.teams.find((t) => t.holderIds.includes(companyId) && canonicalName(t.name) === canon);
    const vehicle = mostCommon(list.map((e) => e.vehicle));
    let teamId: string;
    if (team) {
      teamId = team.id;
      if (vehicle && vehicleNumber.get(team.vehicleId ?? "") !== vehicle) {
        needVehicle(vehicle);
        out.teamVehicles.push({ teamId, vehicle });
      }
    } else {
      teamId = newTeamId(key);
      if (vehicle) needVehicle(vehicle);
      const type = sb.types.find((t) => t.active && canonicalName(t.name) === canon);
      const loc = mostCommon(list.map((e) => (e.location ? (locationOf(e.location) ?? "") : "")));
      out.newTeams.push({ key, name: list[0]!.team, companyId, typeId: type?.id ?? null, locationId: loc, vehicle });
    }
    const wanted = new Set(list.map((e) => personOf(e.personalNumber)));
    // members the sheet no longer has on this team
    for (const m of sb.teamMembers) if (m.teamId === teamId && !wanted.has(m.personId)) out.removeMembers.push({ teamId, personId: m.personId });
    list.forEach((e, sortOrder) => {
      const personId = personOf(e.personalNumber);
      const role = e.role || null;
      const cur = current.get(personId);
      if (cur?.teamId === teamId) {
        if ((cur.role ?? null) !== role) out.roleUpdates.push({ teamId, personId, role });
        return;
      }
      // on another team (one team per soldier per round): moves here
      if (cur) out.removeMembers.push({ teamId: cur.teamId, personId });
      out.addMembers.push({ teamId, personId, role, sortOrder });
    });
  }

  // a soldier the sheet lists with no team (לא בכוננות) leaves whatever team they are on
  for (const e of sb.entries.values()) {
    if (e.team) continue;
    const cur = current.get(personOf(e.personalNumber));
    if (cur) out.removeMembers.push({ teamId: cur.teamId, personId: cur.personId });
  }
  const seen = new Set<string>();
  out.removeMembers = out.removeMembers.filter((r) => !seen.has(`${r.teamId}|${r.personId}`) && !!seen.add(`${r.teamId}|${r.personId}`));
  return out;
}
