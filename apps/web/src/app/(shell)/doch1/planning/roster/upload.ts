import "server-only";
/**
 * The battalion list upload, shared by run/route.ts and corrections/route.ts: the file (xlsx or
 * csv, read in memory, never stored), the answers to the mapping questions, the round to compare
 * with and the admin's decisions.
 */
import { z } from "zod";
import { parseRoster, readRosterFile, RosterImportError, type RosterAnswers, type RosterDecisions, type RosterFile } from "@gdud/db/doch1-roster-import";
import { actionError, UserError } from "@/lib/action-result";
import { firstIssue, uuid } from "../../_actions/common";

/** Vercel rejects request bodies over 4.5 MB; leave room for the rest of the form. */
const MAX_FILE_BYTES = 3.9 * 1024 * 1024;
const MAX_ITEMS = 5000;

const target = z.string().min(1).max(200);
const record = z.record(z.string().max(200), target).refine((r) => Object.keys(r).length <= MAX_ITEMS, "יותר מדי תשובות");
const answersInput = z.object({ companies: record.optional(), platoons: record.optional(), arrival: record.optional() });
const decisionsInput = z.object({
  add: z.array(z.string().max(20)).max(MAX_ITEMS),
  take: z.record(z.string().max(20), z.array(z.enum(["name", "unit", "phone", "role"])).max(4)).refine((r) => Object.keys(r).length <= MAX_ITEMS),
  keepMissing: z.array(uuid).max(MAX_ITEMS),
});

export interface RosterUpload {
  file: RosterFile;
  answers: RosterAnswers;
  baseRoundId: string | undefined;
  decisions: RosterDecisions;
}

function json(fd: FormData, key: string): unknown {
  try {
    return JSON.parse(String(fd.get(key) ?? "{}"));
  } catch {
    throw new UserError("הבקשה לא תקינה");
  }
}

export async function readRosterUpload(fd: FormData): Promise<RosterUpload> {
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new UserError("צריך קובץ xlsx או csv");
  if (!/\.(xlsx|csv)$/i.test(f.name)) throw new UserError("צריך קובץ xlsx או csv");
  if (f.size > MAX_FILE_BYTES) throw new UserError("הקובץ גדול מדי (עד 3.9MB)");
  const answers = answersInput.safeParse(json(fd, "answers"));
  if (!answers.success) throw new UserError(firstIssue(answers.error));
  const decisions = decisionsInput.safeParse(fd.has("decisions") ? json(fd, "decisions") : { add: [], take: {}, keepMissing: [] });
  if (!decisions.success) throw new UserError(firstIssue(decisions.error));
  const base = String(fd.get("baseRoundId") ?? "");
  if (base && !uuid.safeParse(base).success) throw new UserError("הסבב להשוואה לא תקין");

  let grids;
  try {
    grids = await readRosterFile(new Uint8Array(await f.arrayBuffer()), f.name);
  } catch {
    throw new UserError("לא הצלחנו לקרוא את הקובץ. ודאו שזה xlsx או csv.");
  }
  return { file: parseRoster(grids), answers: answers.data, baseRoundId: base || undefined, decisions: decisions.data };
}

/** The importer's own checks carry messages meant for the admin. */
export function rosterError(err: unknown): string {
  return err instanceof RosterImportError ? err.message : actionError(err);
}
