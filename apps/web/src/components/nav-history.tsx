"use client";
/**
 * The pages visited in this tab since the app loaded (client navigations only), so a module's
 * "חזרה" button knows whether there is an in-app page to go back to. Rendered once by the
 * signed-in layout, so the hub counts too. Going back pops the stack.
 */
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

const stack: string[] = [];
const listeners = new Set<() => void>();
let depth = 0;

function record(path: string) {
  if (stack.at(-1) === path) return;
  if (stack.at(-2) === path) stack.pop();
  else stack.push(path);
  depth = stack.length;
  for (const l of listeners) l();
}

export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => record(pathname), [pathname]);
  return null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Is there an in-app page before this one? */
export function useCanGoBack(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => depth > 1,
    () => false,
  );
}
