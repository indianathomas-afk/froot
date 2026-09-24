import { getCurrentUser } from "@/lib/auth"
import { MyShellClient } from "./my-shell-client"

// NAV-2 — the server half of the /my shell. Every /my page renders <MyShell>,
// and this is the ONE place the viewer's role is read, so no page can forget
// to pass it. A non-STAFF login (ADMIN, MANAGER, STORE) arrives here from the
// dashboard compliance banner and needs a way back; STAFF live here.
//
// Fails closed: if the role cannot be resolved, no link — the STAFF header.
export async function MyShell({
  children,
  showInstagram = false,
}: {
  children: React.ReactNode
  showInstagram?: boolean
}) {
  let showDashboardLink = false
  try {
    const { dbUser } = await getCurrentUser()
    showDashboardLink = !!dbUser && dbUser.role !== "STAFF"
  } catch {
    showDashboardLink = false
  }
  return (
    <MyShellClient showInstagram={showInstagram} showDashboardLink={showDashboardLink}>
      {children}
    </MyShellClient>
  )
}
