import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/auth"
import { roadmap } from "@/generated/roadmap"
import { RoadmapClient } from "./roadmap-client"

// Live development dashboard — renders docs/ROADMAP.yaml, the single source of
// truth for phase status. Replaces the hand-generated froot-roadmap-dashboard
// .html snapshot, whose "last updated" date was typed in and went stale on the
// first edit. Here the data comes from the YAML and the timestamp from that
// file's git commit date, both captured at build by scripts/generate-roadmap
// .mjs — so the page cannot silently disagree with the repo.
//
// Read-only by construction: no writes to ROADMAP.yaml, no database access at
// all. The import below is a plain generated module, not a runtime file read.

// Auth is the real protection; noindex is belt-and-suspenders alongside the
// /internal/ disallow in src/app/robots.ts.
export const metadata: Metadata = {
  title: "Roadmap",
  robots: { index: false, follow: false },
}

export default async function RoadmapPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }

  return (
    <RoadmapClient
      phases={roadmap.phases}
      bugs={roadmap.bugs}
      debt={roadmap.debt}
      rulings={roadmap.rulings}
      lastUpdated={roadmap.lastUpdated}
      lastUpdatedSource={roadmap.lastUpdatedSource}
    />
  )
}
