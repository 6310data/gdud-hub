"use client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A table row that navigates on click. Keep a real <Link> in the first cell for keyboard
 * and screen-reader users; this only widens the click target to the whole row.
 */
export function ClickableRow({ href, selected, children }: { href: string; selected?: boolean; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      data-href={href}
      data-selected={selected || undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,label")) return;
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </tr>
  );
}
