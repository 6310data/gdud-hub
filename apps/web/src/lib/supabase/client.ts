"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "../env";

export function createSupabaseBrowser() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
