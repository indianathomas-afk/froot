import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { NutritionUpgradeCard } from "../upgrade-card"
import { NutritionImportClient } from "./nutrition-import-client"

// N-1 deliverable 4: nutrition CSV import. ADMIN only (nutrition.manage, F3);
// both modules (R-4). The preview/apply APIs check both again.
export default async function NutritionImportPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.manage")) redirect("/nutrition/menu")

  return <NutritionImportClient />
}
