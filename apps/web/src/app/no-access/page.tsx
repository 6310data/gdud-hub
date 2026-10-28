import { redirect } from "next/navigation";

/** Old address of "אין לך עדיין גישה": an account without access now asks to join (/join). */
export default function NoAccessPage() {
  redirect("/join");
}
