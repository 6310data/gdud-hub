import { requireSession } from "@/lib/session";

/**
 * Signed-in area. Each module draws its own frame (components/app-shell.tsx); the hub pages
 * (home, ניהול מערכת, modules still in the making) share the (hub) frame.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return children;
}
