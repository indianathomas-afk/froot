"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NutritionFactsLabel } from "@/components/nutrition/nutrition-facts-label"
import { NUTRIENTS } from "@/lib/nutrition"
import { DEFAULT_SERVING_FL_OZ, buildLabel, flOzError, formatFlOz, type ServingSpec } from "@/lib/nutrition-label"
import type { ItemLabelData } from "@/lib/nutrition-serving"

const PICKS = [8, 12, 16, 20]

function describeVolume(data: ItemLabelData): string {
  const s = data.spec
  if (s.kind === "perItem") {
    return s.source === "override"
      ? "Set to “per item” for this item — the whole item is one serving."
      : `“${data.variationName || "(no size name)"}” isn't in the size table, so the whole item is one serving.`
  }
  return s.volumeSource === "override"
    ? `Item volume ${formatFlOz(s.volumeFlOz)} — this item's own setting.`
    : `Item volume ${formatFlOz(s.volumeFlOz)} — from the size table (“${data.variationName}”).`
}

function describeServing(s: Extract<ServingSpec, { kind: "volume" }>): string {
  const src = s.servingSource === "override" ? "this item's own setting" : s.servingSource === "org" ? "the org setting" : "the default"
  return `Serving size ${formatFlOz(s.servingFlOz)} — ${src}.`
}

export function LabelPreviewClient({ data, canManage }: { data: ItemLabelData; canManage: boolean }) {
  const saved = data.spec
  const [pick, setPick] = useState<string>(String(saved.kind === "volume" ? saved.servingFlOz : DEFAULT_SERVING_FL_OZ))
  const pickNum = Number(pick)
  const pickError = pick.trim() === "" ? "Enter a serving size" : flOzError(pickNum, "Serving size")

  // The picker previews only; it never saves (deliverable 6).
  const previewSpec: ServingSpec = useMemo(() => {
    if (saved.kind !== "volume" || pickError) return saved
    return pickNum === saved.servingFlOz ? saved : { ...saved, servingFlOz: pickNum }
  }, [saved, pickNum, pickError])
  const result = useMemo(() => buildLabel(data, previewSpec), [data, previewSpec])
  const previewing = saved.kind === "volume" && previewSpec !== saved

  const printHref = `/print/nutrition-label/${data.salesItemId}${previewing ? `?serving=${pickNum}` : ""}`

  return (
    <div className="mt-2">
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{data.displayName}</h1>
      {data.menuGroup && <p className="text-sm text-[var(--color-muted-foreground)]">{data.menuGroup}</p>}

      {!result.ok ? (
        // F4: "An item whose calculation has an error shows the error and a link to the recipe, no label."
        <div className="mt-6 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] px-4 py-3 text-sm">
          <p className="font-medium">No label — this item&apos;s nutrition can&apos;t be calculated.</p>
          <p className="mt-1">{result.error}</p>
          <Link href={`/inventory/recipes/${data.recipeId}`} className="underline mt-2 inline-block">Open the recipe to fix it</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-[auto_1fr]">
          <div className="space-y-3">
            {result.label.estimated && (
              // F4: "'Estimated — not for publication' banner on any item not fully Verified, including items with no food ingredients".
              <div className="max-w-[22rem] rounded-md border-2 border-[#efa201] bg-[#efa201]/10 px-3 py-2 text-sm">
                <div className="font-bold">Estimated — not for publication</div>
                <div className="text-xs mt-0.5">
                  {data.verification === "NO_FOOD"
                    ? "This item has no food ingredients to verify."
                    : "Not every ingredient’s nutrition is verified against a real label."}
                </div>
              </div>
            )}
            <NutritionFactsLabel label={result.label} />
            {result.label.missing.length > 0 && (
              <p className="max-w-[22rem] text-xs text-[#efa201]">
                &ldquo;—&rdquo; means not known: an ingredient is missing{" "}
                {result.label.missing.map((k) => NUTRIENTS.find((n) => n.key === k)!.label.toLowerCase()).join(", ")}. It is
                never counted as zero.
              </p>
            )}
            {!result.label.contains && (
              <p className="max-w-[22rem] text-xs text-[var(--color-muted-foreground)]">No allergens are recorded on this item&apos;s ingredients.</p>
            )}
          </div>

          <div className="space-y-6 text-sm">
            <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
              <h2 className="font-medium">Serving</h2>
              <p className="text-[var(--color-muted-foreground)]">{describeVolume(data)}</p>
              {saved.kind === "volume" && <p className="text-[var(--color-muted-foreground)]">{describeServing(saved)}</p>}
              {saved.kind === "volume" ? (
                <div className="pt-2">
                  <Label htmlFor="pick" className="text-sm">Preview at another serving size (fl oz)</Label>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {PICKS.map((p) => (
                      <Button key={p} type="button" size="sm" variant={pickNum === p ? "default" : "outline"} onClick={() => setPick(String(p))}>
                        {p}
                      </Button>
                    ))}
                    <Input id="pick" type="number" min="0" step="any" className="w-24" value={pick} onChange={(e) => setPick(e.target.value)} />
                  </div>
                  {pickError && <p className="text-xs text-[var(--color-destructive)] mt-1">{pickError}</p>}
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                    {previewing ? "Preview only — the saved setting is unchanged." : "Showing the saved setting."}{" "}
                    {canManage && (
                      <>Change it in <Link href="/nutrition/settings" className="underline">Serving Settings</Link>.</>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-muted-foreground)]">A per-item label has no serving size to change.</p>
              )}
              <div className="pt-2">
                <a
                  href={printHref}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 text-sm hover:bg-[var(--color-muted)]"
                >
                  <Printer className="h-4 w-4" /> Print label
                </a>
              </div>
            </section>

            {canManage && <OverrideForm data={data} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ADMIN: this item's own serving (F3: "a volume, a serving size, or 'per item'").
function OverrideForm({ data }: { data: ItemLabelData }) {
  const router = useRouter()
  const o = data.override
  const [mode, setMode] = useState<"none" | "perItem" | "custom">(o ? (o.perItem ? "perItem" : "custom") : "none")
  const [volume, setVolume] = useState(o?.volumeFlOz?.toString() ?? "")
  const [serving, setServing] = useState(o?.servingFlOz?.toString() ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setSaving(true)
    const url = `/api/nutrition/items/${data.salesItemId}/serving`
    const res =
      mode === "none"
        ? await fetch(url, { method: "DELETE" })
        : await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mode === "perItem"
                ? { perItem: true, volumeFlOz: null, servingFlOz: null }
                : { perItem: false, volumeFlOz: volume.trim() ? Number(volume) : null, servingFlOz: serving.trim() ? Number(serving) : null }
            ),
          })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(body.error ?? "Couldn't save")
    router.refresh()
  }

  const radio = (value: typeof mode, label: string, hint: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="radio" name={`override-${data.salesItemId}`} className="mt-1" checked={mode === value} onChange={() => setMode(value)} />
      <span>
        {label}
        <span className="block text-xs text-[var(--color-muted-foreground)]">{hint}</span>
      </span>
    </label>
  )

  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <h2 className="font-medium">This item&apos;s serving</h2>
      {radio(
        "none",
        "Use the size table",
        data.tableVolumeFlOz !== null
          ? `“${data.variationName}” = ${data.tableVolumeFlOz} fl oz; serving ${data.orgServingFlOz ?? DEFAULT_SERVING_FL_OZ} fl oz.`
          : `“${data.variationName || "(no size name)"}” isn't in the size table, so this is per item.`
      )}
      {radio("perItem", "Per item", "The whole item is one serving — for bowls, cookies, or a size name shared with food.")}
      {radio("custom", "Custom", "This item's own volume and/or serving size. A blank box uses the table or org setting.")}
      {mode === "custom" && (
        <div className="flex flex-wrap gap-4 pl-6">
          <div>
            <Label htmlFor="ov-volume" className="text-xs">Item volume (fl oz)</Label>
            <Input id="ov-volume" type="number" min="0" step="any" className="w-28" value={volume} onChange={(e) => setVolume(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ov-serving" className="text-xs">Serving size (fl oz)</Label>
            <Input id="ov-serving" type="number" min="0" step="any" className="w-28" value={serving} onChange={(e) => setServing(e.target.value)} />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </section>
  )
}
