import { requireModule } from "@/lib/session";
import { StandbyScreen } from "./standby-screen";

export const metadata = { title: "דוח 1 · שבצ״ק וכוננות" };

export default async function Doch1Standby({ searchParams }: { searchParams: Promise<{ view?: string; co?: string; check?: string; day?: string }> }) {
  const s = await requireModule("doch1");
  return <StandbyScreen s={s} sp={await searchParams} path="/doch1/standby" />;
}
