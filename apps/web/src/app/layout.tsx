import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
// Self-hosted fonts (served from our own origin: no Google request at runtime or build).
import "@fontsource/ibm-plex-sans-hebrew/hebrew-400.css";
import "@fontsource/ibm-plex-sans-hebrew/hebrew-500.css";
import "@fontsource/ibm-plex-sans-hebrew/hebrew-600.css";
import "@fontsource/ibm-plex-sans-hebrew/hebrew-700.css";
import "@fontsource/ibm-plex-sans-hebrew/latin-400.css";
import "@fontsource/ibm-plex-sans-hebrew/latin-500.css";
import "@fontsource/ibm-plex-sans-hebrew/latin-600.css";
import "@fontsource/ibm-plex-sans-hebrew/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "גדוד", template: "%s · גדוד" },
  description: "מערכת הגדוד",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers keeps every page dynamically rendered,
  // which the nonce-based CSP set in proxy.ts requires.
  await headers();
  return (
    <html lang="he" dir="rtl">
      <body className="tz-screen">{children}</body>
    </html>
  );
}
