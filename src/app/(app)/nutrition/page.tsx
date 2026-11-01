import { redirect } from "next/navigation"

// The Nutrition section's landing: its children are /nutrition/menu and
// /nutrition/import (kept as siblings so the sidebar's prefix match never
// lights both). N-1.
export default function NutritionIndexPage() {
  redirect("/nutrition/menu")
}
