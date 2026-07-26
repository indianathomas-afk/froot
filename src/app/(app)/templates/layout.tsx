import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

// PERM-2 §3 #2: templates are corporate-controlled so procedures stay
// consistent across stores — ADMIN only, and all three layers now agree (nav
// NV-4, this layout, the list page and every API). This layout previously
// admitted MANAGER, who could then open detail/edit/new pages where every
// action 403'd.
export default async function TemplatesLayout({ children }: { children: React.ReactNode }) {
  // redirect() throws NEXT_REDIRECT — it must stay outside the try, or the
  // catch swallows it and a denied user renders the page anyway.
  let role: string | null = null
  try {
    const { dbUser } = await getCurrentUser()
    role = dbUser?.role ?? null
  } catch {
    role = null
  }
  if (!can({ role }, "templates.manage")) redirect("/dashboard")
  return children
}
