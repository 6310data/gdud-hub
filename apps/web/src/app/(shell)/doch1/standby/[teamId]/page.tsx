import { requireModule } from "@/lib/session";
import { TeamScreen } from "./team-screen";

export const metadata = { title: "דוח 1 · עריכת צוות כוננות" };

export default async function Doch1StandbyTeam({ params }: { params: Promise<{ teamId: string }> }) {
  const s = await requireModule("doch1");
  const { teamId } = await params;
  return <TeamScreen s={s} teamId={teamId} basePath="/doch1/standby" />;
}
