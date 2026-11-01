import Link from "next/link"
import { Apple } from "lucide-react"

// Shown when the org lacks inventory or nutrition (R-4: both are required).
export function NutritionUpgradeCard() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
          <Apple className="h-6 w-6 text-[var(--color-primary)]" />
        </div>
        <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Nutrition</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
          Nutrition facts and allergens computed from your recipes — needs both the Inventory and Nutritional Information
          add-ons.
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Upgrade Plan
        </Link>
      </div>
    </div>
  )
}
