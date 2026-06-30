import { requireManagerOrAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireManagerOrAdmin()
  } catch {
    redirect("/dashboard")
  }
  return children
}
