"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_SERVING_FL_OZ, flOzError } from "@/lib/nutrition-label"

export type SizeRow = {
  variationName: string
  itemCount: number
  menuGroups: string[]
  savedFlOz: number | null
  suggestedFlOz: number | null
}

const toText = (v: number | null) => (v === null ? "" : String(v))

export function ServingSettingsClient({ orgServingFlOz, rows }: { orgServingFlOz: number | null; rows: SizeRow[] }) {
  const router = useRouter()
  const [serving, setServing] = useState(toText(orgServingFlOz))
  // F6: an unsaved name with a volume in it starts PRE-FILLED — shown as a
  // suggestion until Save confirms it.
  const [volumes, setVolumes] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.variationName, toText(r.savedFlOz ?? r.suggestedFlOz)]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const parse = (s: string) => (s.trim() === "" ? null : Number(s))

  async function save() {
    setError(null)
    setSavedNote(null)
    const servingFlOz = parse(serving)
    if (servingFlOz !== null) {
      const err = flOzError(servingFlOz, "Serving size")
      if (err) return setError(err)
    }
    const sizes = rows.map((r) => ({ variationName: r.variationName, volumeFlOz: parse(volumes[r.variationName] ?? "") }))
    for (const s of sizes) {
      if (s.volumeFlOz === null) continue
      const err = flOzError(s.volumeFlOz, `“${s.variationName || "(no size name)"}”`)
      if (err) return setError(err)
    }
    setSaving(true)
    const res = await fetch("/api/nutrition/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servingFlOz, sizes }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(body.error ?? "Couldn't save")
    setSavedNote("Saved.")
    router.refresh()
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-1">Serving Settings</h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        How Nutrition Facts labels split a drink into servings. A size that has a volume here is labeled per serving,
        with two columns when it holds more than one serving; anything without a volume (bowls, cookies, retail) is
        labeled per item. One item can override this on its label page.
      </p>

      <section className="rounded-lg border border-[var(--color-border)] p-4 mb-6">
        <Label htmlFor="serving" className="font-medium">Drink serving size (fl oz)</Label>
        <div className="flex items-center gap-3 mt-2">
          <Input
            id="serving"
            type="number"
            min="0"
            step="any"
            className="w-28"
            placeholder={String(DEFAULT_SERVING_FL_OZ)}
            value={serving}
            onChange={(e) => setServing(e.target.value)}
          />
          <span className="text-sm text-[var(--color-muted-foreground)]">
            Blank = {DEFAULT_SERVING_FL_OZ} fl oz. A drink under twice this size is one serving of the whole cup.
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)]">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="font-medium">Size table</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Square size names on items that have a recipe, matched exactly — &ldquo;20oz.&rdquo; and &ldquo;20oz&rdquo; are
            separate rows. Leave a name blank to label its items per item.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-[var(--color-muted-foreground)]">
            No sales items have recipes yet, so there are no sizes to set. Add recipes under Inventory → Recipes.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                <th className="text-left px-4 py-2 font-medium">Size name</th>
                <th className="text-right px-4 py-2 font-medium">Items</th>
                <th className="text-left px-4 py-2 font-medium">Menu groups</th>
                <th className="text-left px-4 py-2 font-medium">Volume (fl oz)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = volumes[r.variationName] ?? ""
                const suggested = r.savedFlOz === null && r.suggestedFlOz !== null && parse(value) === r.suggestedFlOz
                return (
                  <tr key={r.variationName} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {r.variationName ? `“${r.variationName}”` : <span className="text-[var(--color-muted-foreground)]">(no size name)</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.itemCount || <span className="text-[var(--color-muted-foreground)]">none</span>}</td>
                    <td className="px-4 py-2 text-xs text-[var(--color-muted-foreground)]">{r.menuGroups.join(", ")}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          className="w-24"
                          value={value}
                          aria-label={`Volume for ${r.variationName || "no size name"}`}
                          onChange={(e) => setVolumes((v) => ({ ...v, [r.variationName]: e.target.value }))}
                        />
                        {suggested && <Badge variant="outline" title="Read from the size name — not saved until you Save">Suggested</Badge>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex items-center gap-3 mt-4">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {savedNote && <span className="text-sm text-[#25ba3b]">{savedNote}</span>}
      </div>
    </div>
  )
}
