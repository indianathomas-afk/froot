"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Download, Upload } from "lucide-react"
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
import { IMPORT_COLUMNS } from "@/lib/nutrition"
import type { NutritionRowPlan, NutritionRowStatus } from "@/lib/nutrition-import"

type Result = { rows: NutritionRowPlan[]; summary: Record<NutritionRowStatus, number>; applied?: number }

// Written for a store owner. Order = the order the lists appear in.
const STATUSES: { status: NutritionRowStatus; title: string; help: string; writes: boolean }[] = [
  { status: "NEW", title: "New nutrition", help: "", writes: true },
  { status: "UPDATE", title: "Replaces existing nutrition", help: "The whole record is replaced: a blank cell becomes unknown.", writes: true },
  { status: "DETAILS_ONLY", title: "Allergens or not-food flag only", help: "Nutrition values stay as they are.", writes: true },
  { status: "NOT_FOOD", title: "Marked not food", help: "Cups, lids, napkins and the like — they never make an item incomplete. Any nutrition already saved is kept.", writes: true },
  { status: "UNCHANGED", title: "Unchanged", help: "These rows match what's saved, so nothing is written.", writes: false },
  { status: "UNMATCHED", title: "No matching ingredient", help: "The name must match an ingredient exactly (spacing and capitals don't matter), with or without its brand. Import never creates ingredients.", writes: false },
  { status: "AMBIGUOUS", title: "Name matches more than one ingredient", help: "Rename one so it's unique, or include the brand.", writes: false },
  { status: "DUPLICATE", title: "Ingredient appears twice", help: "Only the first row for an ingredient is used.", writes: false },
  { status: "INVALID", title: "Can't be imported", help: "", writes: false },
]

export function NutritionImportClient() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function send(path: "preview" | "apply") {
    if (!file) return
    setBusy(path)
    setError(null)
    try {
      const csv = await file.text()
      const res = await fetch(`/api/nutrition/import/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, fileName: file.name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      setResult(data)
      if (path === "apply") router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const applied = result?.applied !== undefined
  const writeCount = result ? result.summary.NEW + result.summary.UPDATE + result.summary.DETAILS_ONLY + result.summary.NOT_FOOD : 0

  return (
    <div className="max-w-4xl">
      <Link href="/nutrition/menu" className="inline-flex items-center text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" /> Menu Nutrition
      </Link>
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Import nutrition</h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1 mb-2">
        Upload a CSV with one row per ingredient. Values are per <span className="font-medium">basis_amount basis_unit</span>{" "}
        (e.g. per 1 fl. oz, per 28 g, per 1 each), in a unit of the same kind the ingredient is counted in. Leave a cell blank
        when it&apos;s unknown — blank is never treated as zero. Allergens are separated by semicolons (e.g. &quot;milk; tree
        nuts&quot;).
      </p>
      <p className="text-xs text-[var(--color-muted-foreground)] mb-6 font-mono break-all">{IMPORT_COLUMNS.join(",")}</p>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Button variant="outline" asChild>
          <a href="/api/nutrition/template" download>
            <Download className="h-4 w-4" />
            Download template
          </a>
        </Button>
        <label className="inline-flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 text-sm cursor-pointer hover:bg-[var(--color-muted)]">
          <Upload className="h-4 w-4" />
          {file ? file.name : "Choose file"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setResult(null)
              setError(null)
            }}
          />
        </label>
        <Button variant="outline" disabled={!file || busy !== null} onClick={() => send("preview")}>
          Preview
        </Button>
        {result && !applied && (
          <Button disabled={writeCount === 0 || busy !== null} onClick={() => setConfirming(true)}>
            Import {writeCount} row{writeCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)] mb-6">
        Starts with all your ingredients — fill in the numbers and import it back.
      </p>

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

      {!busy && !result && !error && (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          Choose your nutrition CSV and press Preview — nothing is saved until you import.
        </div>
      )}

      {!busy && result && (
        <>
          <div className="rounded-lg border border-[var(--color-border)] p-4 mb-6">
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              {applied ? `Imported ${result.applied} row${result.applied === 1 ? "" : "s"}.` : `${writeCount} row${writeCount === 1 ? "" : "s"} ready`}
              {STATUSES.filter((s) => !s.writes && result.summary[s.status]).map((s) => ` · ${result.summary[s.status]} ${s.title.toLowerCase()}`)}
            </p>
          </div>
          {STATUSES.map(({ status, title, help }) => {
            const list = result.rows.filter((r) => r.status === status)
            if (!list.length) return null
            return (
              <details key={status} className="rounded-lg border border-[var(--color-border)] mb-3" open={!applied && status === "INVALID"}>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {title} ({list.length})
                </summary>
                <div className="px-4 pb-3">
                  {help && <p className="text-xs text-[var(--color-muted-foreground)] mb-2">{help}</p>}
                  <ul className="text-sm space-y-1">
                    {list.map((r) => (
                      <li key={r.rowNumber}>
                        <span className="text-[var(--color-muted-foreground)] tabular-nums mr-2">Row {r.rowNumber + 1}</span>
                        <span className="font-medium">{r.label}</span>
                        {r.ingredientName && r.ingredientName !== r.label && (
                          <span className="text-[var(--color-muted-foreground)]"> → {r.ingredientName}</span>
                        )}
                        {r.detail && <div className="text-xs text-[var(--color-muted-foreground)]">{r.detail}</div>}
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
            <AlertDialogTitle>Import {writeCount} row{writeCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {result?.summary.UPDATE
                ? `${result.summary.UPDATE} ingredient${result.summary.UPDATE === 1 ? "'s" : "s'"} existing nutrition will be replaced. `
                : ""}
              Rows that can&apos;t be imported are skipped. Nutrition claims carry liability — check the preview first.
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
