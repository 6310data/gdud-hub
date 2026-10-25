/** Client side of lib/progress-stream.ts. */
import type { ActionOutcome } from "./action-result";

export type ProgressEvent<T> =
  | { type: "phase"; phase: string; done?: number; total?: number }
  | { type: "note"; phase: string; note: string }
  | { type: "result"; data: T }
  | { type: "error"; error: string };

const UNREACHABLE = "הבקשה לא הגיעה לשרת – בדקו את החיבור ונסו שוב";

/** POST `body` and call `onEvent` for every phase / note; resolves with the final result. */
export async function postWithProgress<T>(
  url: string,
  body: FormData,
  onEvent: (e: Extract<ProgressEvent<T>, { type: "phase" | "note" }>) => void,
): Promise<ActionOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body });
  } catch {
    return { error: UNREACHABLE };
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    try {
      return { error: (JSON.parse(text) as { error?: string }).error ?? UNREACHABLE };
    } catch {
      return { error: res.status === 413 ? "הקובץ גדול מדי" : UNREACHABLE };
    }
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const e = JSON.parse(line) as ProgressEvent<T>;
        if (e.type === "result") return { ok: true, data: e.data };
        if (e.type === "error") return { error: e.error };
        onEvent(e);
      }
    }
  } catch {
    return { error: "החיבור לשרת נקטע לפני הסוף. רעננו את הדף ובדקו אם הפעולה הושלמה." };
  }
  return { error: "החיבור לשרת נקטע לפני הסוף. רעננו את הדף ובדקו אם הפעולה הושלמה." };
}
