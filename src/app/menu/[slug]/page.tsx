import { cache } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { findLiveMenuOrg, getPublicMenuPayload } from "@/lib/public-menu-data"
import { PublicMenuClient } from "./public-menu-client"

// N-3: the PUBLIC nutrition menu — no login (`/menu/(.*)` in src/proxy.ts),
// read-only, embeddable (`?embed=1`; frame-ancestors in next.config.ts). It
// receives ONLY the payload built by buildPublicMenu (src/lib/public-menu.ts);
// no app-side object reaches this file. Unknown slug, menu off, or the
// nutrition/inventory module off → the same plain 404, with no hint that the
// org exists (prompt item 6, R-2). Liveness is read fresh per request; the
// payload is cached per org (R-3).

type Params = Promise<{ slug: string }>

const load = cache(async (slug: string) => {
  const orgId = await findLiveMenuOrg(slug)
  return orgId ? getPublicMenuPayload(orgId) : null
})

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const payload = await load((await params).slug)
  if (!payload) return {}
  return { title: `${payload.orgName} — Nutrition`, description: `Nutrition and allergen information for ${payload.orgName}.` }
}

export default async function PublicMenuPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const payload = await load(slug)
  if (!payload) notFound()
  return <PublicMenuClient payload={payload} embed={sp.embed === "1"} />
}
