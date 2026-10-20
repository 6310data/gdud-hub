import { ComingSoon } from "@/components/coming-soon";
import { requireModule } from "@/lib/session";

export const metadata = { title: "דוח 1" };

export default async function Doch1Page() {
  await requireModule("doch1");
  return <ComingSoon module="doch1" />;
}
