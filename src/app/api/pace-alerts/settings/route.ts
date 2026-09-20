import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"

// PUT /api/pace-alerts/settings — the org's behind-pace alert settings
// (NOTIFY-2a). Writes Organization.paceAlertsEnabled (F-5b) and
// Organization.paceAlertThresholdPct (F1, Gary 2026-09-20).
//
// THIS REPLACES POST /api/pace-alerts/toggle, WHICH IS DELETED. That route's
// only caller was the /settings island this phase moved, so nothing is left
// pointing at it. Keeping it alive would have left two write paths to the same
// column — which is the shape of the problem this phase exists to end one layer
// up, at the two-pages-one-switch level.
//
// BOTH FIELDS ARE OPTIONAL AND AT LEAST ONE IS REQUIRED, rather than a
// full-state PUT of `{ enabled, thresholdPct }`. The card has two controls with
// genuinely different save semantics — the switch writes instantly and reverts
// on failure, the threshold has a Save button — so a full-state body would mean
// the switch posting a threshold it was not asked to change, and an optimistic
// revert having to undo two fields. A partial body means neither control can
// clobber the other.
//
// ADMIN-ONLY, on the deleted route's gate exactly: turning org-wide email on,
// or moving the number that decides who gets it, is an org-governance action.
// The inline requireAdmin() stays even though settings.access already gated the
// page, per PERM-2 — a gate on a page is not a gate on an endpoint. Same gate
// as HR-16's PUT /api/hr/settings.
//
// NO AVAILABILITY GATE, unlike hr/toggle and labor/toggle. There is no
// PACE_ALERTS_MODULE_AVAILABLE env var: F-5 shipped 2026-07-10 to every org and
// was never a staged rollout, so — as with calendarEnabled — the column IS the
// only gate.

// 50–100, integer. NARROWER THAN THE ENV FALLBACK ACCEPTS, DELIBERATELY (F1):
// paceThresholdPct() takes any finite value in (0,100] including fractions, and
// this takes whole numbers from 50 up. The asymmetry is recorded in
// docs/DECISIONS.md and docs/MIGRATIONS.md. The floor exists because this is a
// box an admin types into and 5 and 95 are one keystroke apart — a threshold
// below 50 does not alert on a store doing half its goal, which is not a
// setting anyone means to choose.
//
// null is the way to CLEAR it and fall back to the deployment default; it is
// not the same as absent, which means "leave this field alone".
const MIN_THRESHOLD_PCT = 50
const MAX_THRESHOLD_PCT = 100

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    thresholdPct: z
      .number()
      .int(`Use a whole number between ${MIN_THRESHOLD_PCT} and ${MAX_THRESHOLD_PCT}.`)
      .min(MIN_THRESHOLD_PCT)
      .max(MAX_THRESHOLD_PCT)
      .nullable()
      .optional(),
  })
  .refine((b) => b.enabled !== undefined || b.thresholdPct !== undefined, {
    message: "Nothing to update",
  })

export async function PUT(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // The threshold message is worth surfacing — an admin who typed 30 should
    // read why it bounced rather than a bare "Invalid body".
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first?.message ?? "Invalid body" },
      { status: 400 }
    )
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: {
      ...(parsed.data.enabled !== undefined ? { paceAlertsEnabled: parsed.data.enabled } : {}),
      ...(parsed.data.thresholdPct !== undefined
        ? { paceAlertThresholdPct: parsed.data.thresholdPct }
        : {}),
    },
  })

  // NO PaceAlertLog ROW IS TOUCHED BY ANY OF THIS, and that is deliberate for
  // each field. Turning alerts OFF leaves this month's already-sent rows alone,
  // so re-enabling mid-month does not re-send an alert the managers already got
  // — the one-alert-per-store-per-month promise is kept across a toggle.
  // Turning them ON writes nothing either: the next 15:00 UTC run evaluates the
  // org's stores from scratch. And CHANGING THE THRESHOLD DOES NOT RE-OPEN A
  // SPENT MONTH: a store that already alerted at 90 does not alert again when
  // the threshold moves to 75, because the lock is keyed on store-month and
  // knows nothing about the number. Nor does it rewrite what past rows say they
  // were measured against.
  return NextResponse.json({
    enabled: updated.paceAlertsEnabled,
    thresholdPct: updated.paceAlertThresholdPct,
  })
}
