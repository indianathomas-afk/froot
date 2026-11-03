import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { NutritionUpgradeCard } from "../upgrade-card"
import { LabelInboxClient } from "./label-inbox-client"

// N-1e: the label inbox — drop many labels, read them one at a time within
// N-1c's limits, step through a review queue. ADMIN only (nutrition.manage);
// both modules (R-4). Every /api/nutrition/labels route checks both again.
export default async function LabelInboxPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.manage")) redirect("/nutrition/menu")

  return <LabelInboxClient />
}
