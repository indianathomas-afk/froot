"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

type IngredientRef = {
  id: string
  brand: string | null
  name: string
  categoryName: string | null
  packDescription: string | null
  sku: string | null
}

type Pair = {
  ingredientA: IngredientRef
  ingredientB: IngredientRef
  matchReason: "sku" | "name"
  similarity: number
}

function displayName(i: IngredientRef) {
  return i.brand ? `${i.brand} ${i.name}` : i.name
}

function pairId(pair: Pair) {
  return `${pair.ingredientA.id}|${pair.ingredientB.id}`
}

export function DuplicatesClient() {
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [mergingPair, setMergingPair] = useState<Pair | null>(null)
  const [survivorId, setSurvivorId] = useState<string | null>(null)

  function load() {
    fetch("/api/inventory/ingredients/duplicates")
      .then((r) => r.json())
      .then(setPairs)
      .catch(() => setPairs([]))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDismiss(pair: Pair) {
    setBusyKey(pairId(pair))
    try {
      await fetch("/api/inventory/ingredients/duplicates/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientAId: pair.ingredientA.id, ingredientBId: pair.ingredientB.id }),
      })
      setPairs((prev) => prev?.filter((p) => pairId(p) !== pairId(pair)) ?? null)
    } finally {
      setBusyKey(null)
    }
  }

  function openMerge(pair: Pair) {
    setMergingPair(pair)
    setSurvivorId(pair.ingredientA.id)
  }

  async function handleMerge() {
    if (!mergingPair || !survivorId) return
    const mergedId = survivorId === mergingPair.ingredientA.id ? mergingPair.ingredientB.id : mergingPair.ingredientA.id
    setBusyKey(pairId(mergingPair))
    try {
      await fetch("/api/inventory/ingredients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId, mergedId }),
      })
      setMergingPair(null)
      load()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Link href="/inventory/ingredients" className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3">
          <ArrowLeft className="h-4 w-4" />
          Back to Ingredients
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)] flex items-center gap-2">
          <Shuffle className="h-5 w-5" />
          Duplicate Ingredients
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Likely duplicates by matching SKU or similar name. Merge is safest before purchase and count history piles up —
          different pack sizes of the same item (e.g. two &quot;Boba straws&quot; bag sizes) should usually be dismissed, not merged.
        </p>
      </div>

      {pairs === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : pairs.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
          <p className="text-sm">No likely duplicates found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map((pair) => {
            const key = pairId(pair)
            const busy = busyKey === key
            return (
              <div key={key} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 flex items-center justify-between gap-4">
                <div className="flex-1 grid grid-cols-2 gap-4">
                  {[pair.ingredientA, pair.ingredientB].map((ing) => (
                    <div key={ing.id}>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{displayName(ing)}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {ing.categoryName ?? "No category"}{ing.packDescription ? ` · ${ing.packDescription}` : ""}{ing.sku ? ` · SKU ${ing.sku}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <Badge variant={pair.matchReason === "sku" ? "warning" : "secondary"}>
                  {pair.matchReason === "sku" ? "Same SKU" : `${Math.round(pair.similarity * 100)}% name match`}
                </Badge>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => handleDismiss(pair)} disabled={busy}>Dismiss</Button>
                  <Button size="sm" onClick={() => openMerge(pair)} disabled={busy}>Merge</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!mergingPair} onOpenChange={(o) => !o && setMergingPair(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge duplicate ingredients</DialogTitle>
          </DialogHeader>
          {mergingPair && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Pick which one survives. The other is deleted and its vendor prices and purchase order history move to the
                survivor.
              </p>
              <RadioGroup value={survivorId ?? undefined} onValueChange={setSurvivorId}>
                {[mergingPair.ingredientA, mergingPair.ingredientB].map((ing) => (
                  <div key={ing.id} className="flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2">
                    <RadioGroupItem value={ing.id} id={`survivor-${ing.id}`} />
                    <Label htmlFor={`survivor-${ing.id}`} className="flex-1 cursor-pointer">
                      {displayName(ing)}
                      <span className="block text-xs text-[var(--color-muted-foreground)]">
                        {ing.categoryName ?? "No category"}{ing.packDescription ? ` · ${ing.packDescription}` : ""}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergingPair(null)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={!survivorId}>Merge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
