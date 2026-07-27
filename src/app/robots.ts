import type { MetadataRoute } from "next"

// First robots.txt for the app — before this the site served none, so crawlers
// were free to index everything. Behaviour for public routes is unchanged
// (allow all); the only new instruction is the /internal/ disallow covering the
// admin-only roadmap dashboard. Auth is the real protection there — this and
// the page-level `robots: { index: false }` metadata are belt-and-suspenders.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/internal/",
    },
  }
}
