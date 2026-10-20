import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Local dev: one .env at the monorepo root serves the app and the DB scripts.
// On Vercel, env vars come from the project settings instead.
for (const file of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), "../..", file);
  if (existsSync(p)) process.loadEnvFile(p);
}

// Content-Security-Policy is set per request (with a nonce) in src/proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@gdud/ui", "@gdud/core", "@gdud/auth", "@gdud/db"],
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
