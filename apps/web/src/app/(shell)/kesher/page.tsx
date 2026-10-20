import { ComingSoon } from "@/components/coming-soon";
import { requireModule } from "@/lib/session";

export const metadata = { title: "מחלקת קשר" };

export default async function KesherPage() {
  await requireModule("kesher");
  return <ComingSoon module="kesher" />;
}
