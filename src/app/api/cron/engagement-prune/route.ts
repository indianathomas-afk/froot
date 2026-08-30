import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { USAGE_RETENTION_DAYS } from "@/lib/engagement"

// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — GET /api/cron/engagement-prune. Daily retention sweep.
//
// ENG-1 ruling 2: UsageDaily rows are kept 180 days and pruned by cron. That
// retention is the ONLY reason the day dimension is safe to keep — without this
// route the table grows forever at (users x paths) rows per day, and the
// bounded-growth claim in the model's own comment stops being true.
//
// Registered in vercel.json; Vercel calls it with "Authorization: Bearer
// ${CRON_SECRET}", the same self-authentication every route under /api/cron uses
// (the path is public in src/proxy.ts precisely because cron carries no
// session). Pattern copied from api/cron/sales-reconcile/route.ts.
//
// ONE deleteMany, NO org loop. Unlike the Square crons this touches no external
// service and needs no per-store politeness — the cutoff is absolute and the
// same for every tenant, and a single indexed delete is both cheaper and harder
// to get half-right than a loop that could fail on org three of nine.
//
// FAILURE IS SWALLOWED into a 200 with ok:false rather than a 500. A retention
// sweep that could not run is a fact to read in the cron log, not an incident —
// the next day's run deletes the same rows plus one day's more.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The cutoff is a bare UTC date, matching how @db.Date stores the column. Day
  // granularity is deliberate: an exact-instant cutoff would make the boundary
  // depend on what time the cron happened to fire.
  const cutoff = new Date()
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCDate(cutoff.getUTCDate() - USAGE_RETENTION_DAYS)

  try {
    const { count } = await prisma.usageDaily.deleteMany({ where: { date: { lt: cutoff } } })
    console.log(
      `[cron:engagement-prune] deleted ${count} UsageDaily row(s) older than ${cutoff.toISOString().slice(0, 10)}`
    )
    return NextResponse.json({ ok: true, deleted: count, cutoff: cutoff.toISOString().slice(0, 10) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "prune failed"
    console.error(`[cron:engagement-prune] ${msg}`)
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) })
  }
}
