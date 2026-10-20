import { notFound } from "next/navigation";
import { can } from "@gdud/auth";
import { ComingSoon } from "@/components/coming-soon";
import { requireModule } from "@/lib/session";

export default async function CompanyPage({ params }: { params: Promise<{ unit: string }> }) {
  const { unit: code } = await params;
  const { user, units, parents } = await requireModule("company");
  const company = units.find((u) => u.kind === "company" && u.code === code);
  if (!company || !can(user, "company", "any", company.id, parents)) notFound();

  return <ComingSoon module="company" note={`ניהול פלוגה עבור ${company.name} — יועבר מ-platoon-web.`} />;
}
