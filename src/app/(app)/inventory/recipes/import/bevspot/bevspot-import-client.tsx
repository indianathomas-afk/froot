"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { PlanSkip, PlanSummary, SkipReason } from "@/lib/bevspot/plan-import"

type Preview = {
  summary: PlanSummary
  ready: { kind: "sales" | "sub" | "modifier"; name: string; lineCount: number; recipeRaw: string }[]
  skipped: PlanSkip[]
}

type Applied = Preview & { created: number; createdSubRecipes: number; createdModifierRecipes?: number }

// Written for a store owner. Order = the order the lists appear in.
const REASONS: { reason: SkipReason; title: string; help: string }[] = [
  { reason: "MISSING_INGREDIENT", title: "Needs an ingredient", help: "A line names something Froot doesn't have. Add the ingredient (same name as BevSpot) and import again." },
  { reason: "CONFLICT", title: "BevSpot has more than one recipe", help: "BevSpot holds different recipes for the same item. Pick one in BevSpot or build it in Froot by hand." },
  { reason: "AMBIGUOUS_NAME", title: "Name matches more than one thing", help: "Two ingredients or recipes answer to the same name. Rename one so it's unique." },
  { reason: "SUSPECT_QTY", title: "Uses a whole package", help: "A line uses a whole case, bag, tub or package — almost always a BevSpot typo. Fix the amount in BevSpot or build the recipe by hand." },
  { reason: "BAD_UNIT", title: "Unit doesn't fit", help: "A line's unit can't convert to how Froot counts that ingredient (e.g. fl. oz vs oz (dry))." },
  { reason: "LOOP", title: "Recipes use each other", help: "These recipes would contain themselves." },
  { reason: "INVALID", title: "Rejected by Froot's recipe checks", help: "" },
  { reason: "NEGATIVE_QTY", title: "Negative amounts", help: "BevSpot uses these for removals. Froot imports them only on a Square modifier's recipe (\"No Banana\"), never on a menu item or prep recipe." },
  { reason: "NOT_IN_SQUARE", title: "Not one of your Square items", help: "BevSpot links these to a Square id that is neither a sales item nor a modifier in Froot. Sync from Square first if you expected them." },
  { reason: "ALREADY_HAS_RECIPE", title: "Already has a recipe", help: "Froot never overwrites a recipe." },
  { reason: "MARKED_NON_RECIPE", title: "Marked \"no recipe\" in Froot", help: "Left as you set them." },
  { reason: "NO_RECIPE", title: "No recipe in BevSpot", help: "" },
  { reason: "NO_SQUARE_ID", title: "Not linked to Square in BevSpot", help: "Nothing imported uses these." },
  { reason: "DROPPED_GROUP", title: "Archived or Unassigned in BevSpot", help: "Old rows. Never imported." },
  { reason: "PARSE_ERROR", title: "Couldn't read the recipe", help: "" },
]

export function BevSpotImportClient() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function send(path: "preview" | "apply") {
    if (!file) return
    setBusy(path)
    setError(null)
    try {
      const body = new FormData()
      body.append("file", file)
      const res = await fetch(`/api/inventory/import/bevspot/${path}`, { method: "POST", body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      if (path === "preview") {
        setPreview(data)
        setApplied(null)
      } else {
        setApplied(data)
        setPreview(null)
        router.refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  const shown = applied ?? preview
  const readyCount = preview?.summary.ready ?? 0
  const subCount = preview?.summary.readySubRecipes ?? 0
  // N-5: modifier recipes count toward what an import creates.
  const modifierCount = preview?.summary.readyModifiers ?? 0
  const importCount = readyCount + modifierCount

  return (
    <div className="max-w-4xl">
      <Link href="/inventory/recipes" className="inline-flex items-center text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" /> Recipes
      </Link>
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Import recipes from BevSpot</h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1 mb-6">
        Upload BevSpot&apos;s Sales Items export (.xlsx). Recipes apply to every store. Froot only adds recipes for items that
        don&apos;t have one yet, and skips any recipe it can&apos;t match completely — fix what&apos;s listed and import again.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="inline-flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 text-sm cursor-pointer hover:bg-[var(--color-muted)]">
          <Upload className="h-4 w-4" />
          {file ? file.name : "Choose file"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setPreview(null)
              setApplied(null)
              setError(null)
            }}
          />
        </label>
        <Button variant="outline" disabled={!file || busy !== null} onClick={() => send("preview")}>
          Preview
        </Button>
        {preview && (
          <Button disabled={importCount === 0 || busy !== null} onClick={() => setConfirming(true)}>
            Import {importCount} recipe{importCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>
      )}

      {busy && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {!busy && !shown && !error && (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          In BevSpot, open Sales Items and export to Excel. Then choose that file here and press Preview — nothing is saved
          until you import.
        </div>
      )}

      {!busy && shown && (
        <>
          <div className="rounded-lg border border-[var(--color-border)] p-4 mb-6">
            {applied ? (
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                Imported {applied.created} recipe{applied.created === 1 ? "" : "s"}
                {(applied.createdModifierRecipes ?? 0) > 0 &&
                  `, ${applied.createdModifierRecipes} modifier recipe${applied.createdModifierRecipes === 1 ? "" : "s"}`}
                {applied.createdSubRecipes > 0 && ` and ${applied.createdSubRecipes} prep recipe${applied.createdSubRecipes === 1 ? "" : "s"}`}.
                Fix the items below and import the same file again — recipes already in Froot are left alone.
              </p>
            ) : (
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {readyCount} recipe{readyCount === 1 ? "" : "s"} ready
                {modifierCount > 0 && `, ${modifierCount} modifier recipe${modifierCount === 1 ? "" : "s"}`}
                {subCount > 0 && ` (plus ${subCount} prep recipe${subCount === 1 ? "" : "s"} they use)`}
                {REASONS.filter((r) => shown.summary.skippedByReason[r.reason]).map((r) => ` · ${shown.summary.skippedByReason[r.reason]} ${r.title.toLowerCase()}`)}
              </p>
            )}
          </div>

          {shown.summary.actionNames.length > 0 && (
            <details className="rounded-lg border border-[var(--color-border)] mb-3" open>
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                To fix, by how many recipes each blocks ({shown.summary.actionNames.length})
              </summary>
              <ul className="px-4 pb-3 text-sm space-y-1">
                {shown.summary.actionNames.map((a) => (
                  <li key={`${a.reason}|${a.name}`} className="flex items-center justify-between gap-3">
                    <span>{a.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline">{REASONS.find((r) => r.reason === a.reason)?.title ?? a.reason}</Badge>
                      <span className="text-[var(--color-muted-foreground)] tabular-nums">{a.blocks}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!applied && preview && preview.ready.length > 0 && (
            <details className="rounded-lg border border-[var(--color-border)] mb-3">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Ready to import ({preview.ready.length})</summary>
              <ul className="px-4 pb-3 text-sm space-y-2">
                {preview.ready.map((r) => (
                  <li key={`${r.kind}|${r.name}`}>
                    <span className="font-medium">{r.name}</span>
                    {r.kind === "sub" && <Badge variant="outline" className="ml-2">Prep</Badge>}
                    {r.kind === "modifier" && <Badge variant="outline" className="ml-2">Modifier</Badge>}
                    <div className="text-xs text-[var(--color-muted-foreground)]">{r.recipeRaw}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {REASONS.map(({ reason, title, help }) => {
            const list = shown.skipped.filter((s) => s.reason === reason)
            if (!list.length) return null
            return (
              <details key={reason} className="rounded-lg border border-[var(--color-border)] mb-3">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {title} ({list.length})
                </summary>
                <div className="px-4 pb-3">
                  {help && <p className="text-xs text-[var(--color-muted-foreground)] mb-2">{help}</p>}
                  <ul className="text-sm space-y-2">
                    {list.map((s, i) => (
                      <li key={`${s.rowNumbers.join(",")}|${i}`}>
                        <span className="font-medium">{s.label}</span>
                        <span className="text-xs text-[var(--color-muted-foreground)]"> · row {s.rowNumbers.join(", ")}</span>
                        <div className="text-xs">{s.detail}</div>
                        {s.recipeRaw.map((raw) => (
                          <div key={raw} className="text-xs text-[var(--color-muted-foreground)]">BevSpot: {raw}</div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )
          })}
        </>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import {importCount} recipe{importCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {subCount > 0 ? `This also adds ${subCount} prep recipe${subCount === 1 ? "" : "s"}. ` : ""}
              The recipes apply to every store. Existing recipes are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                send("apply")
              }}
            >
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
