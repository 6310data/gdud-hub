/**
 * Close matches between a soldier's name as someone typed it (a sheet cell: often a first name
 * only, a last name only, or spelled differently) and the full names on דוח 1's list. Pure; the
 * caller decides what a guess may do (the kesher import shows it in the preview for the admin to
 * confirm or change — it never links silently).
 */

const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/** One word in comparison form: no punctuation, final letters as regular ones, ו/י doubling collapsed. */
function wordKey(w: string): string {
  return w
    .toLowerCase()
    .replace(/['"׳״`.]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .replace(/וו/g, "ו")
    .replace(/יי/g, "י");
}

/** A name's words in comparison form. */
export function nameWords(s: string): string[] {
  return s
    .split(/[\s\-–,()]+/)
    .map(wordKey)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 = same word; a short form ("אבי" for "אביחי") or a one-letter slip scores lower. */
function wordScore(a: string, b: string): number {
  if (a === b) return 1;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const prefix = Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)) ? 0.8 : 0;
  return Math.max(sim, prefix);
}

/**
 * How well a typed name fits a full name, 0–1. Every typed word is matched to a different word of
 * the full name (any order); a typed name with fewer words (first name only) scores a little
 * below the full name typed out.
 */
export function nameMatchScore(typed: string, fullName: string): number {
  const a = nameWords(typed);
  const b = nameWords(fullName);
  if (!a.length || !b.length || a.length > b.length) return 0;
  const free = [...b];
  let sum = 0;
  for (const w of a) {
    let best = -1;
    let at = -1;
    free.forEach((f, i) => {
      const s = wordScore(w, f);
      if (s > best) [best, at] = [s, i];
    });
    sum += best;
    free.splice(at, 1);
  }
  return (sum / a.length) * (0.85 + (0.15 * a.length) / b.length);
}

/** Below this a soldier isn't offered at all. */
export const NAME_CANDIDATE_MIN = 0.7;
/** A guess is offered as the answer only from this score, and only when no one else is close. */
export const NAME_GUESS_MIN = 0.8;
const NAME_GUESS_MARGIN = 0.05;
const MAX_CANDIDATES = 6;

export type NameGuess<T> =
  /** one soldier fits clearly better than the rest */
  | { kind: "guess"; best: T; ranked: T[] }
  /** several fit about as well (or none well enough) — someone has to choose */
  | { kind: "unsure"; ranked: T[] }
  | { kind: "none" };

/** The soldiers whose name fits `typed`, best first. */
export function guessName<T extends { fullName: string }>(typed: string, people: readonly T[]): NameGuess<T> {
  const scored = people
    .map((p) => ({ p, score: nameMatchScore(typed, p.fullName) }))
    .filter((x) => x.score >= NAME_CANDIDATE_MIN)
    .sort((x, y) => y.score - x.score);
  if (!scored.length) return { kind: "none" };
  const ranked = scored.slice(0, MAX_CANDIDATES).map((x) => x.p);
  const [first, second] = scored;
  if (first!.score >= NAME_GUESS_MIN && (!second || second.score < first!.score - NAME_GUESS_MARGIN)) return { kind: "guess", best: first!.p, ranked };
  return { kind: "unsure", ranked };
}
