import { NavHistory } from "@/components/nav-history";
import { TableSort } from "@/components/table-sort";
import { requireSession } from "@/lib/session";

/**
 * Signed-in area. Each module draws its own frame (components/app-shell.tsx); the hub pages
 * (home, ניהול מערכת, modules still in the making) share the (hub) frame. Every table's columns
 * sort by a click on the header (TableSort). NavHistory remembers the in-app pages for "חזרה".
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <>
      {children}
      <TableSort />
      <NavHistory />
    </>
  );
}
