import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/company/access";

/** /company: a member opens their company, a soldier their אני. */
export default async function CompanyHome() {
  const { access } = await requireCompany();
  redirect(access.home ? `/company/${access.home.company.id}` : "/company/me");
}
