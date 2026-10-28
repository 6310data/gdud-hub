import { requireModule } from "@/lib/session";
import { TodayScreen } from "./today-screen";

export const metadata = { title: "דוח 1 של היום" };

export default async function Doch1Today({ searchParams }: { searchParams: Promise<{ unit?: string; day?: string }> }) {
  const s = await requireModule("doch1");
  return <TodayScreen s={s} sp={await searchParams} path="/doch1/today" />;
}
