import { getModule, type ModuleId } from "@gdud/core";
import { LargeTitle, Section } from "@gdud/ui";

/** Placeholder for a department that hasn't been ported yet. */
export function ComingSoon({ module, note }: { module: ModuleId; note?: string }) {
  const m = getModule(module)!;
  return (
    <>
      <LargeTitle sub={m.description}>{m.name}</LargeTitle>
      <Section footer={note ?? "המחלקה הזו עוד לא הועברה למערכת החדשה."}>
        <div className="p-4 text-ink-muted">בבנייה</div>
      </Section>
    </>
  );
}
