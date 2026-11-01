"use client"

import { useEffect, useState } from "react"
import type { Allergen } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ALLERGENS, NUTRIENTS, allergenLabel, allowedBasisUnits, type NutrientKey } from "@/lib/nutrition"

// N-1 deliverable 7: nutrition, allergens and the not-food flag, as a section
// of the ingredient dialog (F6). It loads and saves through
// /api/nutrition/ingredients/[id] — never the inventory PATCH — because only
// ADMIN edits nutrition (F3) while MANAGER may edit the rest of the dialog.
// A non-admin sees it read-only. Its own Save, so the two writes never depend
// on each other.

type Loaded = {
  kind: string
  reportingUnit: string
  nutritionExempt: boolean
  allergens: Allergen[]
  nutrition: ({ basisAmount: number; basisUnit: string; sourceNote: string | null } & Record<NutrientKey, number | null>) | null
}

type Form = {
  exempt: boolean
  allergens: Set<Allergen>
  basisAmount: string
  basisUnit: string
  values: Record<NutrientKey, string>
  sourceNote: string
}

function toForm(d: Loaded): Form {
  return {
    exempt: d.nutritionExempt,
    allergens: new Set(d.allergens),
    basisAmount: d.nutrition ? String(d.nutrition.basisAmount) : "",
    basisUnit: d.nutrition?.basisUnit ?? d.reportingUnit,
    values: Object.fromEntries(NUTRIENTS.map((n) => [n.key, d.nutrition?.[n.key] == null ? "" : String(d.nutrition[n.key])])) as Record<NutrientKey, string>,
    sourceNote: d.nutrition?.sourceNote ?? "",
  }
}

export function NutritionSection({
  ingredientId,
  canEdit,
  onSaved,
}: {
  ingredientId: string
  canEdit: boolean
  onSaved: () => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/nutrition/ingredients/${ingredientId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setLoadError(body.error ?? "Couldn't load nutrition")
        else {
          setData(body)
          setForm(toForm(body))
        }
      })
      .catch(() => !cancelled && setLoadError("Couldn't load nutrition"))
    return () => {
      cancelled = true
    }
  }, [ingredientId])

  if (loadError) return <p className="text-xs text-[var(--color-destructive)]">{loadError}</p>
  if (!data || !form) return <Skeleton className="h-24 w-full" />

  if (data.kind === "PREPARED") {
    return (
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Prepared ingredient — its nutrition and allergens are computed from its recipe.
      </p>
    )
  }

  const blank = form.basisAmount.trim() === "" && NUTRIENTS.every((n) => form.values[n.key].trim() === "")
  const disabled = !canEdit || saving

  async function save() {
    if (!form) return
    setSaving(true)
    setMessage(null)
    try {
      const nutrition = blank
        ? null
        : {
            basisAmount: Number(form.basisAmount),
            basisUnit: form.basisUnit,
            values: Object.fromEntries(
              NUTRIENTS.map((n) => [n.key, form.values[n.key].trim() === "" ? null : Number(form.values[n.key])])
            ),
            sourceNote: form.sourceNote.trim() || null,
          }
      const res = await fetch(`/api/nutrition/ingredients/${ingredientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nutrition, allergens: [...form.allergens], nutritionExempt: form.exempt }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ ok: false, text: body.error ?? "Save failed" })
        return
      }
      setData(body)
      setForm(toForm(body))
      setMessage({ ok: true, text: "Nutrition saved" })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="nutrition-exempt" checked={form.exempt} disabled={disabled} onCheckedChange={(v) => set({ exempt: v === true })} />
        <Label htmlFor="nutrition-exempt" className="text-sm font-normal">
          Not food — cups, lids, napkins, supplies. Never counted and never makes an item incomplete.
        </Label>
      </div>

      <div>
        <Label className="mb-1 block">Contains</Label>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {ALLERGENS.map((a) => (
            <div key={a.value} className="flex items-center gap-1.5">
              <Checkbox
                id={`allergen-${a.value}`}
                checked={form.allergens.has(a.value)}
                disabled={disabled}
                onCheckedChange={(v) => {
                  const next = new Set(form.allergens)
                  if (v === true) next.add(a.value)
                  else next.delete(a.value)
                  set({ allergens: next })
                }}
              />
              <Label htmlFor={`allergen-${a.value}`} className="text-xs font-normal">{allergenLabel(a.value)}</Label>
            </div>
          ))}
        </div>
      </div>

      <div className={form.exempt ? "opacity-60" : undefined}>
        {form.exempt && <p className="text-xs text-[var(--color-muted-foreground)] mb-2">Ignored while marked not food.</p>}
        <div className="flex items-end gap-2 mb-2">
          <div className="w-24">
            <Label>Per</Label>
            <Input type="number" value={form.basisAmount} disabled={disabled} onChange={(e) => set({ basisAmount: e.target.value })} />
          </div>
          <div className="w-32">
            <Select value={form.basisUnit} disabled={disabled} onValueChange={(v) => set({ basisUnit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowedBasisUnits(data.reportingUnit).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] pb-2">Leave a value blank if it&apos;s unknown.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NUTRIENTS.map((n) => (
            <div key={n.key}>
              <Label className="text-xs">{n.label} ({n.unit})</Label>
              <Input
                type="number"
                min={0}
                value={form.values[n.key]}
                disabled={disabled}
                onChange={(e) => set({ values: { ...form.values, [n.key]: e.target.value } })}
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <Label className="text-xs">Source</Label>
          <Input placeholder="label, USDA FDC #…, supplier spec" value={form.sourceNote} disabled={disabled} onChange={(e) => set({ sourceNote: e.target.value })} />
        </div>
      </div>

      {message && <p className={`text-xs ${message.ok ? "text-[#25ba3b]" : "text-[var(--color-destructive)]"}`}>{message.text}</p>}
      {canEdit ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save nutrition"}</Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-muted-foreground)]">Only admins can edit nutrition.</p>
      )}
    </div>
  )
}
