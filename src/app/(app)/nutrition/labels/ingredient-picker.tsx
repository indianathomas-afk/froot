"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { InboxIngredient, InboxItem } from "./label-inbox-client"

// N-1e: which ingredient an inbox file is for. N1E-F2 (Gary, 2026-11-02,
// "Accept all leans"): "suggest, never assign; the ADMIN confirms every file's
// ingredient before Apply is enabled." A suggestion is shown as a suggestion
// with its own Confirm button; nothing is saved until the ADMIN clicks Confirm
// or picks an ingredient. The select starts EMPTY even when there is a
// suggestion, so a confirmed value always came from a click.

const label = (i: InboxIngredient) => (i.brand ? `${i.brand} ${i.name}` : i.name)

export function IngredientPicker({
  item,
  ingredients,
  disabled,
  onAssign,
}: {
  item: InboxItem
  ingredients: InboxIngredient[]
  disabled?: boolean
  onAssign: (ingredientId: string | null) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const suggested = !item.ingredientId && item.suggestedIngredientId ? ingredients.find((i) => i.id === item.suggestedIngredientId) : undefined
  const confirmed = item.ingredientId ? ingredients.find((i) => i.id === item.ingredientId) : undefined
  const assign = (id: string | null) => {
    setSaving(true)
    onAssign(id).finally(() => setSaving(false))
  }
  const off = disabled || saving

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-64 max-w-full">
        <Select value={item.ingredientId ?? ""} disabled={off} onValueChange={(v) => assign(v || null)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick the ingredient…" />
          </SelectTrigger>
          <SelectContent>
            {ingredients.map((i) => (
              <SelectItem key={i.id} value={i.id} className="text-xs">{label(i)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {confirmed && (
        <>
          <span className="text-xs text-[#25ba3b]">Confirmed</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={off} onClick={() => assign(null)}>Change</Button>
        </>
      )}
      {suggested && (
        <>
          <span className="text-xs text-[var(--color-muted-foreground)]">Suggested: {label(suggested)}</span>
          <Button size="sm" className="h-7 text-xs" disabled={off} onClick={() => assign(suggested.id)}>Confirm</Button>
        </>
      )}
      {!confirmed && !suggested && <span className="text-xs text-[#efa201]">No confident match — pick one</span>}
    </div>
  )
}
