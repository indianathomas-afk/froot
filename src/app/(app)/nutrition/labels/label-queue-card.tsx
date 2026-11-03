"use client"

import { useEffect, useState } from "react"
import type { Allergen } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { NutrientKey } from "@/lib/nutrition"
import { buildLabelReview, storedForReview } from "@/lib/label-review"
import { LabelReadReview, type ReviewedValues } from "../../inventory/ingredients/label-read-review"
import { IngredientPicker } from "./ingredient-picker"
import type { InboxIngredient, InboxItem } from "./label-inbox-client"

// N-1e deliverable 3: one card of the review queue. The N-1c side-by-side
// review (label-read-review.tsx, unchanged) against the CONFIRMED ingredient,
// then Apply & mark verified / Apply only / Skip / Discard.
//
// Apply is the dialog's Apply with one step in front: POST …/labels/[id]/attach
// (the file becomes the label document; returns a readId), then the EXISTING
// PUT /api/nutrition/ingredients/[id] with appliedFromRead, then …/verify —
// the same three bodies nutrition-section.tsx applyRead sends. No second
// write path. Apply stays disabled until the ADMIN confirms the ingredient
// (N1E-F2).

type Snapshot = {
  name: string
  brand: string | null
  kind: string
  reportingUnit: string
  nutritionExempt: boolean
  allergens: Allergen[]
  nutrition: ({ basisAmount: number | null; basisUnit: string | null; sourceNote: string | null; status: string } & Record<NutrientKey, number | null>) | null
}

export type Ask = (q: { title: string; body: string; yes: string; no?: string }) => Promise<boolean | null>

export function LabelQueueCard({
  item,
  ingredients,
  position,
  total,
  ask,
  onAssign,
  onApplied,
  onSkip,
  onDiscard,
  onReadAgain,
}: {
  item: InboxItem
  ingredients: InboxIngredient[]
  position: number
  total: number
  /** Opens a confirm; resolves true (yes), false (no), or null (cancelled). */
  ask: Ask
  onAssign: (ingredientId: string | null) => Promise<void>
  onApplied: (message: string) => void
  onSkip: () => void
  onDiscard: () => void
  onReadAgain: () => Promise<void>
}) {
  // Keyed by the ingredient it was loaded for, so a change of ingredient shows
  // the skeleton until the new one arrives — never the old one's numbers.
  const [loaded, setLoaded] = useState<{ ingredientId: string; snapshot: Snapshot | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const ingredientId = item.ingredientId
    if (!ingredientId) return
    let cancelled = false
    fetch(`/api/nutrition/ingredients/${ingredientId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setLoaded({ ingredientId, snapshot: null, error: body.error ?? "Couldn't load the ingredient" })
        else setLoaded({ ingredientId, snapshot: body, error: null })
      })
      .catch(() => !cancelled && setLoaded({ ingredientId, snapshot: null, error: "Couldn't load the ingredient" }))
    return () => {
      cancelled = true
    }
  }, [item.ingredientId])

  const current = loaded && loaded.ingredientId === item.ingredientId ? loaded : null
  const snapshot = current?.snapshot ?? null
  const loadError = current?.error ?? null

  const read = item.read
  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm font-medium truncate" title={item.fileName}>{item.fileName}</p>
      <span className="text-xs text-[var(--color-muted-foreground)]">Label {position} of {total}</span>
    </div>
  )

  async function apply(v: ReviewedValues, verify: boolean) {
    if (!snapshot || !item.ingredientId || !read) return
    setBusy(true)
    setMessage(null)
    try {
      // 1. Attach — asks "Replace current label?" and "Still verified?" first.
      const answers: { replaceLabel?: boolean; keepVerified?: boolean } = verify ? { keepVerified: false } : {}
      let attached: { readId: string | null } | null = null
      for (;;) {
        const res = await fetch(`/api/nutrition/labels/${item.id}/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(answers),
        })
        const body = await res.json().catch(() => ({}))
        if (res.status === 409 && body.code === "CONFIRM_REPLACE") {
          const yes = await ask({ title: "Replace current label?", body: `${snapshot.name} already has a label document. It is deleted once this one replaces it.`, yes: "Replace" })
          if (!yes) return
          answers.replaceLabel = true
          continue
        }
        if (res.status === 409 && body.code === "CONFIRM_STILL_VERIFIED") {
          const keep = await ask({ title: "Still verified?", body: "This nutrition was verified against a real label. Does it still match with this label and these values?", yes: "Still verified", no: "Mark estimated" })
          if (keep === null) return
          answers.keepVerified = keep
          continue
        }
        if (!res.ok) {
          setMessage(body.error ?? "Couldn't attach the label")
          return
        }
        attached = body
        break
      }
      if (!attached?.readId) {
        onApplied(`The label is now ${snapshot.name}'s document, but the read couldn't be carried over — open the ingredient to apply it.`)
        return
      }

      // 2. The existing PUT, exactly as the dialog's Apply sends it.
      const put = await fetch(`/api/nutrition/ingredients/${item.ingredientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nutrition: { basisAmount: v.basisAmount, basisUnit: v.basisUnit, values: v.values, sourceNote: snapshot.nutrition?.sourceNote ?? null },
          allergens: v.allergens,
          nutritionExempt: snapshot.nutritionExempt,
          ...(verify ? { keepVerified: false } : answers.keepVerified !== undefined && { keepVerified: answers.keepVerified }),
          appliedFromRead: { readId: attached.readId, intent: verify ? "apply-and-verify" : "apply-only", edited: v.edited, nameWarningAcknowledged: v.nameWarningAcknowledged },
        }),
      })
      let putBody = await put.json().catch(() => ({}))
      let putOk = put.ok
      if (put.status === 409 && putBody.code === "CONFIRM_STILL_VERIFIED") {
        // Attach kept it verified; the numbers changed too, so ask once more for this save.
        const keep = await ask({ title: "Still verified?", body: "These values differ from what was verified. Is it still verified?", yes: "Still verified", no: "Mark estimated" })
        if (keep === null) {
          onApplied(`The label is now ${snapshot.name}'s document; the values were not applied. Open the ingredient to finish.`)
          return
        }
        const again = await fetch(`/api/nutrition/ingredients/${item.ingredientId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nutrition: { basisAmount: v.basisAmount, basisUnit: v.basisUnit, values: v.values, sourceNote: snapshot.nutrition?.sourceNote ?? null },
            allergens: v.allergens,
            nutritionExempt: snapshot.nutritionExempt,
            keepVerified: keep,
            appliedFromRead: { readId: attached.readId, intent: "apply-only", edited: v.edited, nameWarningAcknowledged: v.nameWarningAcknowledged },
          }),
        })
        putBody = await again.json().catch(() => ({}))
        putOk = again.ok
      }
      if (!putOk) {
        onApplied(`The label is now ${snapshot.name}'s document, but applying the values failed (${putBody.error ?? "save failed"}). Open the ingredient to finish.`)
        return
      }

      // 3. Verify, as the dialog does.
      if (verify) {
        const vr = await fetch(`/api/nutrition/ingredients/${item.ingredientId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verified: true }),
        })
        if (!vr.ok) {
          onApplied(`${snapshot.name}: label applied, but marking it verified failed — use Mark verified on the ingredient.`)
          return
        }
      }
      onApplied(`${snapshot.name}: label applied${verify ? " and marked verified" : ""}.`)
    } catch {
      setMessage("Applying the label failed — try again")
    } finally {
      setBusy(false)
    }
  }

  if (!read) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
        {header}
        <p className="text-xs text-[var(--color-muted-foreground)]">This label hasn&apos;t been read yet.</p>
        <Button variant="outline" size="sm" onClick={onSkip}>Skip</Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      {header}
      <div className="space-y-1">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Product on label: {`${read.output.brand} ${read.output.productName}`.trim() || "—"}
        </p>
        <IngredientPicker
          item={item}
          ingredients={ingredients}
          disabled={busy}
          onAssign={onAssign}
        />
      </div>

      {!item.ingredientId ? (
        <p className="text-xs text-[#efa201]">Confirm which ingredient this label is for to review and apply it.</p>
      ) : loadError ? (
        <p className="text-xs text-[var(--color-destructive)]">{loadError}</p>
      ) : !snapshot ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <LabelReadReview
          key={`${read.readId}-${item.ingredientId}`}
          review={buildLabelReview(read.output, snapshot, storedForReview(snapshot.nutrition))}
          reportingUnit={snapshot.reportingUnit}
          hasStored={snapshot.nutrition?.basisAmount != null}
          readAt={read.readAt}
          reused={read.reused}
          busy={busy}
          onApply={(v, verify) => apply(v, verify)}
          onReadAgain={() => {
            setBusy(true)
            onReadAgain().finally(() => setBusy(false))
          }}
          onDiscard={onDiscard}
        />
      )}

      {message && <p className="text-xs text-[var(--color-destructive)]">{message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onSkip}>Skip</Button>
        {!item.ingredientId && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDiscard}>Discard file</Button>
        )}
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Skip leaves it in the inbox. Discard (in the review) deletes the file.
        </span>
      </div>
    </div>
  )
}
