import { ComingSoon } from "@/components/coming-soon";
import { requireModule } from "@/lib/session";

export const metadata = { title: "לוגיסטיקה" };

export default async function LogisticsPage() {
  await requireModule("logistics");
  return <ComingSoon module="logistics" />;
}
