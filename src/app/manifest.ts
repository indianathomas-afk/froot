import type { MetadataRoute } from "next"
import { FROOT_CREAM } from "@/lib/froot-cream"

// KEEP THIS AS manifest.ts, NOT manifest.json.
//
// A .ts manifest is served at /manifest.webmanifest, and .webmanifest is one of
// the extensions src/proxy.ts:22 excludes from the Clerk matcher — so iOS can
// fetch it unauthenticated. A static app/manifest.json would be served at
// /manifest.json, and .json is NOT excluded (the matcher's `js(?!on)` declines
// to match it), so Clerk would 307 it to the sign-in page and the home-screen
// install would silently get an HTML document instead of a manifest. Same trap
// robots.ts sits in.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Froot",
    short_name: "Froot",
    description:
      "Operational execution and accountability platform for multi-store franchises",
    // PWA-1 — a stable identity for the installed app, independent of start_url.
    id: "/",
    // Land in the app, not on the marketing page. /dashboard works for every
    // role: unauthenticated it redirects to /sign-in; no org shows the org
    // picker (which itself returns to /dashboard); an HR employee login is
    // redirected to /my by the (app) layout. Note iOS often launches whatever URL
    // was on screen at Add-to-Home-Screen time rather than start_url, so add the
    // tile while on /dashboard.
    start_url: "/dashboard",
    scope: "/",
    // Full screen, no Safari chrome — these are counter terminals. See the
    // commit message of 28bbd8a for what this changes about sign-in.
    display: "standalone",
    background_color: FROOT_CREAM,
    theme_color: FROOT_CREAM,
    // PWA-1 — solid cream tiles, slice centred (~15% padding; maskable ~20% so
    // the mark stays inside the 80% safe circle). No alpha: iOS composites a
    // transparent icon on black.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
