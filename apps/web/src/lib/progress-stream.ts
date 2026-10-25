import "server-only";
/**
 * A long request that reports its steps as it goes: the response is NDJSON, one event per line
 * (`phase` / `note` while it runs, then one `result` or `error`). Read on the client with
 * postWithProgress() (lib/progress-client.ts). Used where a Server Action would leave the user
 * staring at a spinner for minutes (the doch1 sheet import).
 */
import type { ProgressEvent } from "./progress-client";

export interface ProgressEmitter {
  /** a phase starts (or moves on: done of total) */
  phase(phase: string, done?: number, total?: number): void;
  /** extra detail for a phase, without changing the current one */
  note(phase: string, note: string): void;
}

const HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

export function progressResponse<T>(run: (emit: ProgressEmitter) => Promise<T>, errorMessage: (err: unknown) => string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: ProgressEvent<T>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false; // the browser went away; the work itself still finishes
        }
      };
      try {
        const data = await run({
          phase: (phase, done, total) => send({ type: "phase", phase, done, total }),
          note: (phase, note) => send({ type: "note", phase, note }),
        });
        send({ type: "result", data });
      } catch (err) {
        send({ type: "error", error: errorMessage(err) });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: HEADERS });
}

/** Same-origin check for cookie-authenticated POST route handlers (Server Actions do this themselves). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
