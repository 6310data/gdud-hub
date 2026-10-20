import { logisticsAccess } from "@/lib/logistics/access";
import { requireModule } from "@/lib/session";
import { LogisticsNav } from "./_components/logistics-nav";

export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const s = await requireModule("logistics");
  return (
    <div data-wide className="flex flex-col gap-[22px]">
      <LogisticsNav isAdmin={logisticsAccess(s).isAdmin} />
      {children}
    </div>
  );
}
