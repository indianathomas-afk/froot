"use client"

import { useState } from "react"
import type { Allergen } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ALLERGENS, NUTRIENTS, allergenLabel, allowedBasisUnits, type NutrientKey } from "@/lib/nutrition"
import { FLAG_TEXT, type LabelReview } from "@/lib/label-review"

// N-1c deliverable 3: the side-by-side review of a label read. Label value vs
// what is saved now, for every nutrient and allergen; differences and flagged
// values called out; every field editable before Apply. Nothing here saves —
// onApply hands the reviewed values back to NutritionSection, which writes
// through the same PUT as "Save nutrition" (deliverable 4).
//
// Gary, 2026-11-02 — F2: "'Apply & mark verified' as the main button, 'Apply
// only' as secondary." F3: "Name mismatch is a warning plus a 'This is the
// product we use' tickbox, checked in code."

export type ReviewedValues = {
  basisAmount: number
  basisUnit: string
  values: Record<NutrientKey, number | null>
  allergens: Allergen[]
  edited: string[]
  nameWarningAcknowledged: boolean
}

const fmt = (v: number | null) => (v === null ? "" : String(v))
const AMBER = "text-[#efa201]"

export function LabelReadReview({
  review,
  reportingUnit,
  hasStored,
  readAt,
  reused,
  busy,
  onApply,
  onReadAgain,
  onDiscard,
}: {
  review: LabelReview
  reportingUnit: string
  hasStored: boolean
  readAt: string
  reused: boolean
  busy: boolean
  onApply: (values: ReviewedValues, verify: boolean) => void
  onReadAgain: () => void
  onDiscard: () => void
}) {
  const proposedBasis = review.basis.ok ? { amount: String(review.basis.amount), unit: review.basis.unit } : { amount: "", unit: reportingUnit }
  const [basisAmount, setBasisAmount] = useState(proposedBasis.amount)
  const [basisUnit, setBasisUnit] = useState(proposedBasis.unit)
  const [values, setValues] = useState<Record<NutrientKey, string>>(
    () => Object.fromEntries(review.nutrients.map((r) => [r.key, fmt(r.proposed)])) as Record<NutrientKey, string>
  )
  const [allergens, setAllergens] = useState<Set<Allergen>>(() => new Set(review.allergens.proposed))
  const [ack, setAck] = useState(false)

  const amount = Number(basisAmount)
  const basisValid = basisAmount.trim() !== "" && Number.isFinite(amount) && amount > 0
  const valuesValid = NUTRIENTS.every((n) => values[n.key].trim() === "" || (Number.isFinite(Number(values[n.key])) && Number(values[n.key]) >= 0))
  const canApply = !busy && basisValid && valuesValid
  const canVerify = canApply && (!review.nameWarning || ack)

  function collect(): ReviewedValues {
    const edited: string[] = []
    if (basisAmount !== proposedBasis.amount || basisUnit !== proposedBasis.unit) edited.push("basis")
    for (const r of review.nutrients) if (values[r.key].trim() !== fmt(r.proposed)) edited.push(r.key)
    const proposedA = [...review.allergens.proposed].sort().join(",")
    if ([...allergens].sort().join(",") !== proposedA) edited.push("allergens")
    return {
      basisAmount: amount,
      basisUnit,
      values: Object.fromEntries(NUTRIENTS.map((n) => [n.key, values[n.key].trim() === "" ? null : Number(values[n.key])])) as Record<NutrientKey, number | null>,
      allergens: [...allergens],
      edited,
      nameWarningAcknowledged: ack,
    }
  }

  const differing = review.nutrients.filter((r) => r.differs).length
  const flagged = review.nutrients.filter((r) => r.flag).length

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label className="block">Label read — review before applying</Label>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {reused ? "Earlier read of this file" : "Read"} {new Date(readAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      <div className="text-xs space-y-0.5">
        <p><span className="text-[var(--color-muted-foreground)]">Product on label:</span> {review.productName || "—"}</p>
        <p><span className="text-[var(--color-muted-foreground)]">Serving size on label:</span> {review.servingSizeText || "—"}</p>
        <p className="text-[var(--color-muted-foreground)]">
          {differing} value{differing === 1 ? "" : "s"} differ from what&apos;s saved · {flagged} flagged. Nothing is saved until you apply.
        </p>
      </div>

      {review.nameWarning && (
        <div className="rounded-md border border-[#efa201] p-2 space-y-1.5">
          <p className={`text-xs ${AMBER}`}>Name check: {review.nameWarning}</p>
          <div className="flex items-center gap-2">
            <Checkbox id="label-read-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
            <Label htmlFor="label-read-ack" className="text-xs font-normal">This is the product we use</Label>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-end gap-2">
          <div className="w-24">
            <Label className="text-xs">Per</Label>
            <Input type="number" value={basisAmount} disabled={busy} onChange={(e) => setBasisAmount(e.target.value)} />
          </div>
          <div className="w-32">
            <Select value={basisUnit} disabled={busy} onValueChange={setBasisUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowedBasisUnits(reportingUnit).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {review.basis.ok && <p className="text-xs text-[var(--color-muted-foreground)] pb-2">From the label&apos;s {review.basis.from}</p>}
        </div>
        {!review.basis.ok && <p className={`text-xs mt-1 ${AMBER}`}>{review.basis.reason}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--color-muted-foreground)]">
              <th className="font-normal py-1 pr-2">Nutrient</th>
              <th className="font-normal py-1 pr-2">On label</th>
              <th className="font-normal py-1 pr-2">Apply</th>
              <th className="font-normal py-1">{hasStored ? "Saved now (per this basis)" : "Saved now"}</th>
            </tr>
          </thead>
          <tbody>
            {review.nutrients.map((r) => (
              <tr key={r.key} className={`border-t border-[var(--color-border)] align-top ${r.differs ? "bg-[#efa201]/10" : ""}`}>
                <td className="py-1 pr-2">{r.label} <span className="text-[var(--color-muted-foreground)]">({r.unit})</span></td>
                <td className="py-1 pr-2">{r.printed || <span className="text-[var(--color-muted-foreground)]">not on label</span>}</td>
                <td className="py-1 pr-2 w-28">
                  <Input
                    type="number"
                    min={0}
                    className="h-7 text-xs"
                    value={values[r.key]}
                    disabled={busy}
                    onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                  />
                  {r.flag && <p className={`mt-0.5 ${AMBER}`}>{FLAG_TEXT[r.flag]}</p>}
                </td>
                <td className="py-1">{r.storedOnLabelBasis === null ? <span className="text-[var(--color-muted-foreground)]">—</span> : r.storedOnLabelBasis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <Label className="mb-1 block text-xs">Contains</Label>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {ALLERGENS.map((a) => {
            const onLabel = review.allergens.proposed.includes(a.value)
            const saved = review.storedAllergens.includes(a.value)
            return (
              <div key={a.value} className={`flex items-center gap-1.5 ${onLabel !== saved ? AMBER : ""}`}>
                <Checkbox
                  id={`read-allergen-${a.value}`}
                  checked={allergens.has(a.value)}
                  disabled={busy}
                  onCheckedChange={(v) => {
                    const next = new Set(allergens)
                    if (v === true) next.add(a.value)
                    else next.delete(a.value)
                    setAllergens(next)
                  }}
                />
                <Label htmlFor={`read-allergen-${a.value}`} className="text-xs font-normal">
                  {allergenLabel(a.value)}
                  {onLabel !== saved && <span> ({onLabel ? "on label, not saved" : "saved, not on label"})</span>}
                </Label>
              </div>
            )
          })}
        </div>
        <div className="text-xs mt-1.5 space-y-0.5">
          {review.containsText && <p><span className="text-[var(--color-muted-foreground)]">Printed:</span> {review.containsText}</p>}
          {review.mayContainText && <p><span className="text-[var(--color-muted-foreground)]">Also printed (not mapped):</span> {review.mayContainText}</p>}
          {review.allergens.onlyModel.length > 0 && (
            <p className={AMBER}>The reader also mapped {review.allergens.onlyModel.map(allergenLabel).join(", ")}, which the printed line doesn&apos;t name — check the label.</p>
          )}
          {review.allergens.notes.map((t) => <p key={t} className={AMBER}>{t}</p>)}
        </div>
      </div>

      {review.unreadable.length > 0 && (
        <div className="text-xs">
          <p className={AMBER}>Couldn&apos;t read:</p>
          <ul className="list-disc pl-5">{review.unreadable.map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canVerify} onClick={() => onApply(collect(), true)}>Apply &amp; mark verified</Button>
        <Button variant="outline" size="sm" disabled={!canApply} onClick={() => onApply(collect(), false)}>Apply only</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onReadAgain}>Read again</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onDiscard}>Discard</Button>
        {!basisValid && <span className={`text-xs ${AMBER}`}>Enter the basis to apply.</span>}
        {basisValid && review.nameWarning && !ack && <span className={`text-xs ${AMBER}`}>Tick “This is the product we use” to mark verified.</span>}
      </div>
    </div>
  )
}
