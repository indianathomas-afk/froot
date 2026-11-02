"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { TEXT_MAX, normalizeSlug, publishCounts, slugError, type ItemSummary } from "@/lib/public-menu"

export type GroupRow = { id: string; name: string; itemCount: number; verifiedItemCount: number; suggested: boolean }
export type ItemRow = ItemSummary & { squareCategoryId: string; name: string }

type Initial = {
  enabled: boolean
  slug: string
  savedSlug: string | null
  savedEnabled: boolean
  categoryIds: string[]
  hiddenSquareItemIds: string[]
  disclaimer: string
  crossContactNotice: string
}

const noop = () => () => {}
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export function PublishClient({ initial, orgName, groups, items, defaults }: {
  initial: Initial
  orgName: string
  groups: GroupRow[]
  items: ItemRow[]
  defaults: { disclaimer: string; crossContact: string }
}) {
  const router = useRouter()
  // The address shown in the snippets is wherever this page is open — staging
  // shows staging, production shows production. Empty during SSR.
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "")
  const [enabled, setEnabled] = useState(initial.enabled)
  const [slug, setSlug] = useState(initial.slug)
  const [included, setIncluded] = useState(() => new Set(initial.categoryIds))
  const [hidden, setHidden] = useState(() => new Set(initial.hiddenSquareItemIds))
  const [disclaimer, setDisclaimer] = useState(initial.disclaimer)
  const [crossContact, setCrossContact] = useState(initial.crossContactNotice)
  const [itemSearch, setItemSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const counts = useMemo(() => publishCounts(items, included, hidden), [items, included, hidden])
  const slugNorm = normalizeSlug(slug)
  const slugProblem = slugError(slugNorm)

  const visibleItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    return items.filter((i) => included.has(i.squareCategoryId) && (!q || i.name.toLowerCase().includes(q)))
  }, [items, included, itemSearch])

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  async function save() {
    setError(null)
    setSavedNote(null)
    if (slugProblem) return setError(slugProblem)
    setSaving(true)
    const res = await fetch("/api/nutrition/publish", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        slug: slugNorm,
        categoryIds: [...included],
        hiddenSquareItemIds: [...hidden].filter((id) => items.some((i) => i.squareItemId === id)),
        disclaimer: disclaimer.trim() || null,
        crossContactNotice: crossContact.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(body.error ?? "Couldn't save")
    setSlug(body.slug ?? slugNorm)
    setSavedNote(enabled ? "Saved — the public menu is on." : "Saved — the public menu is off.")
    router.refresh()
  }

  const liveSlug = initial.savedEnabled ? initial.savedSlug : null
  const publicUrl = liveSlug && origin ? `${origin}/menu/${liveSlug}` : null
  const iframe = publicUrl
    ? `<iframe id="froot-menu" src="${publicUrl}?embed=1" title="${attr(orgName)} nutrition" loading="lazy" style="width:100%;min-height:600px;border:0"></iframe>`
    : ""
  const script = publicUrl
    ? `<script>
window.addEventListener("message", function (e) {
  if (e.origin !== "${origin}" || !e.data || e.data.type !== "froot-menu-height") return;
  var f = document.getElementById("froot-menu");
  if (f) f.style.height = e.data.height + "px";
});
</script>`
    : ""

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-1">Public Menu</h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        A nutrition menu anyone can open without logging in — link to it from your website or a QR code, or embed it.
        Only fully Verified sizes show numbers and allergens; everything else in a ticked group shows &ldquo;Nutrition
        coming soon&rdquo;. Prices, ingredients and recipes are never shown.
      </p>

      <section className="rounded-lg border border-[var(--color-border)] p-4 mb-6 space-y-4">
        <div className="flex items-center gap-3">
          <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="enabled" className="font-medium">Public menu {enabled ? "on" : "off"}</Label>
        </div>
        <div>
          <Label htmlFor="slug" className="font-medium">Web address</Label>
          <div className="flex items-center gap-1 mt-2 text-sm">
            <span className="text-[var(--color-muted-foreground)]">{origin || ""}/menu/</span>
            <Input id="slug" className="w-64" value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={!!slugProblem} />
          </div>
          {slugProblem ? (
            <p className="text-xs text-[var(--color-destructive)] mt-1">{slugProblem}</p>
          ) : initial.savedSlug && slugNorm !== initial.savedSlug ? (
            <p className="text-xs text-[#efa201] mt-1">Changing the address breaks links and QR codes that use /menu/{initial.savedSlug}.</p>
          ) : null}
        </div>
        <p className="text-sm tabular-nums">
          <strong>{counts.showing}</strong> item{counts.showing === 1 ? "" : "s"} will show nutrition ·{" "}
          <strong>{counts.comingSoon}</strong> will show &ldquo;coming soon&rdquo; · <strong>{counts.hidden}</strong> hidden
        </p>
        {enabled && included.size === 0 && (
          <p className="text-xs text-[#efa201]">No menu groups are ticked, so the public menu will be empty.</p>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] mb-6">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-medium">Menu groups</h2>
            <p className="text-xs text-[var(--color-muted-foreground)]">Square categories. Only ticked groups appear.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIncluded(new Set(groups.filter((g) => g.suggested).map((g) => g.id)))}>
              Tick suggested
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setIncluded(new Set())}>Clear</Button>
          </div>
        </div>
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-[var(--color-muted-foreground)]">
            No menu groups yet. Sync sales items from Square under Inventory → Sales Items, then come back.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {groups.map((g) => (
              <li key={g.id} className="px-4 py-2 flex items-center gap-3">
                <Checkbox id={`g-${g.id}`} checked={included.has(g.id)} onCheckedChange={(v) => setIncluded((s) => toggle(s, g.id, v === true))} />
                <Label htmlFor={`g-${g.id}`} className="flex-1 font-normal cursor-pointer">{g.name}</Label>
                {!g.suggested && <Badge variant="outline" title="Not in the suggested set">Not suggested</Badge>}
                <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums w-40 text-right">
                  {g.verifiedItemCount} of {g.itemCount} with nutrition
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] mb-6">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-medium">Hide items</h2>
            <p className="text-xs text-[var(--color-muted-foreground)]">Items in ticked groups. A hidden item is left off entirely, every size.</p>
          </div>
          <Input className="w-56" placeholder="Search items" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
        </div>
        {visibleItems.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-[var(--color-muted-foreground)]">
            {included.size === 0 ? "Tick a menu group above to choose items to hide." : "No items match."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] max-h-96 overflow-y-auto">
            {visibleItems.map((i) => (
              <li key={i.squareItemId} className="px-4 py-2 flex items-center gap-3">
                <Checkbox id={`h-${i.squareItemId}`} checked={hidden.has(i.squareItemId)} onCheckedChange={(v) => setHidden((s) => toggle(s, i.squareItemId, v === true))} />
                <Label htmlFor={`h-${i.squareItemId}`} className="flex-1 font-normal cursor-pointer">{i.name}</Label>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {i.verifiedSizes > 0 ? `${i.verifiedSizes} of ${i.listedSizes} sizes verified` : "coming soon"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] p-4 mb-6 space-y-4">
        <div>
          <Label htmlFor="disclaimer" className="font-medium">Disclaimer</Label>
          <Textarea id="disclaimer" className="mt-2" maxLength={TEXT_MAX} placeholder={defaults.disclaimer} value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} />
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Blank uses the default shown.</p>
        </div>
        <div>
          <Label htmlFor="cross" className="font-medium">Cross-contact notice</Label>
          <Textarea id="cross" className="mt-2" maxLength={TEXT_MAX} placeholder={defaults.crossContact} value={crossContact} onChange={(e) => setCrossContact(e.target.value)} />
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Always shown with allergens and the allergen filter. Blank uses the default shown.</p>
        </div>
      </section>

      <div className="flex items-center gap-3 mb-8">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {savedNote && <span className="text-sm text-[#25ba3b]">{savedNote}</span>}
      </div>

      <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <h2 className="font-medium">Link and embed</h2>
        {!publicUrl ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Turn the public menu on and save to get its link and embed code.</p>
        ) : (
          <>
            <p className="text-sm">
              Public link:{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline break-all">{publicUrl}</a>
            </p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Embed (paste where the menu should appear)</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => copy("iframe", iframe)}>{copied === "iframe" ? "Copied" : "Copy"}</Button>
              </div>
              <pre className="text-xs bg-[var(--color-muted)] rounded p-2 whitespace-pre-wrap break-all">{iframe}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Optional: auto-height (paste once, after the embed)</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => copy("script", script)}>{copied === "script" ? "Copied" : "Copy"}</Button>
              </div>
              <pre className="text-xs bg-[var(--color-muted)] rounded p-2 whitespace-pre-wrap break-all">{script}</pre>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
