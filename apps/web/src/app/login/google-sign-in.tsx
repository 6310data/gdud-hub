"use client";
import { useState } from "react";
import { Button } from "@gdud/ui";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export function GoogleSignIn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    const supabase = createSupabaseBrowser();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <>
      <Button onClick={signIn} loading={pending} className="w-full">
        {pending ? "מעביר ל-Google…" : "כניסה עם Google"}
      </Button>
      {failed ? (
        <p role="alert" className="tz-footnote mt-3 text-center">
          לא ניתן להתחבר כרגע. נסו שוב בעוד רגע.
        </p>
      ) : null}
    </>
  );
}
