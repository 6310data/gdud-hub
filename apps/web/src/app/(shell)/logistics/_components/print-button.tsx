"use client";
import { Button, Icon } from "@gdud/ui";

/** Opens the browser print dialog ("שמירה כ-PDF" saves the form as a file). */
export function PrintButton({ label = "הדפסה / PDF", variant = "filled" }: { label?: string; variant?: "filled" | "tinted" }) {
  return (
    <Button type="button" small variant={variant} onClick={() => window.print()}>
      <Icon name="print" size={16} />
      {label}
    </Button>
  );
}
