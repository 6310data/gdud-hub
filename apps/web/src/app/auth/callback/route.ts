import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@gdud/auth";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Google → Supabase → here with ?code=…  Exchange it for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/login?error=1", origin));
}
