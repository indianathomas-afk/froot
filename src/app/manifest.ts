import type { MetadataRoute } from "next"

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
    // Land in the app, not on the marketing page. Unauthenticated this redirects
    // to /sign-in, which is correct. Note iOS often launches whatever URL was on
    // screen at Add-to-Home-Screen time rather than start_url, so add the tile
    // while on /dashboard.
    start_url: "/dashboard",
    // Full screen, no Safari chrome — these are counter terminals. See the
    // commit message for what this changes about sign-in.
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#f0532b", // oklch(65% .2 35), the primary brand colour
    icons: [{ src: "/icon.png", sizes: "500x500", type: "image/png" }],
  }
}
