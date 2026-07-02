import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import TemplatesClient from "./templates-client"

export default async function TemplatesPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }
  return <TemplatesClient />
}
