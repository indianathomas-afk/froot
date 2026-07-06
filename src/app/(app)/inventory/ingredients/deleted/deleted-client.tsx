"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ArchiveRestore } from "lucide-react"
import { Button } from "@/components/ui/button"

type DeletedIngredient = {
  id: string
  brand: string | null
  name: string
  categoryName: string | null
  purchaseUnitLabel: string
  packDescription: string | null
  deletedAt: string
}

export function DeletedIngredientsClient({ ingredients }: { ingredients: DeletedIngredient[] }) {
  const router = useRouter()
  const [restoringId, setRestoringId] = useState<string | null>(null)

  async function handleRestore(id: string) {
    setRestoringId(id)
    try {
      await fetch(`/api/inventory/ingredients/${id}/restore`, { method: "POST" })
      router.refresh()
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Link href="/inventory/ingredients" className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3">
          <ArrowLeft className="h-4 w-4" />
          Back to Ingredients
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Deleted Ingredients</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Deleted ingredients are never hard-removed — restore anything here to bring it back.
        </p>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {ingredients.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">Nothing deleted right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["Ingredient", "Category", "Pack", "Deleted", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ingredients.map((ing) => (
                  <tr key={ing.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-sm text-[var(--color-foreground)]">
                      {ing.brand ? `${ing.brand} ` : ""}{ing.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{ing.categoryName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                      {ing.purchaseUnitLabel}{ing.packDescription ? ` (${ing.packDescription})` : ""}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                      {new Date(ing.deletedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => handleRestore(ing.id)} disabled={restoringId === ing.id}>
                        <ArchiveRestore className="h-4 w-4" />
                        {restoringId === ing.id ? "Restoring..." : "Restore"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
