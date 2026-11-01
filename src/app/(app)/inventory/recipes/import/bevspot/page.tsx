import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { BevSpotImportClient } from "./bevspot-import-client"

// BEV-1: import recipes from BevSpot's sales-items export. ADMIN only and
// inventory module only (IV-3); the preview/apply APIs check both again.
export default async function BevSpotImportPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!current.org.activeModules.includes("inventory")) redirect("/inventory/recipes")
  if (current.dbUser?.role !== "ADMIN") redirect("/inventory/recipes")

  return <BevSpotImportClient />
}
