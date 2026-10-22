import type { MetadataRoute } from "next";

/** PWA manifest: "Add to Home Screen" is what lets iPhone users receive push reminders. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "מערכת הגדוד",
    short_name: "גדוד",
    start_url: "/doch1/today",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    // Tzelem --primary / --ground
    theme_color: "#1e3a5f",
    background_color: "#f2f4f7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
