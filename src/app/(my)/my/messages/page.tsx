import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { MessagesClient } from "@/app/(app)/messages/messages-client"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"

// /my/messages — STAFF-1 (F8): the full Team Messages experience inside the
// staff portal, compose included. Reuses the (app) MessagesClient wholesale;
// store scope comes from the LOGIN's StoreUserAssignments (what the messages
// APIs authorize against), not the staff profile's store list.
export default async function MyMessagesPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { org, dbUser } = self

  const storeIds = dbUser.storeAssignments.map((a) => a.storeId)
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, id: { in: storeIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  const showInstagram = !!org.instagramEnabled && !!org.instagramAccessToken

  if (stores.length === 0) {
    return (
      <MyShell showInstagram={showInstagram}>
        <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-4">Messages</h1>
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            You aren&apos;t assigned to a store yet, so there&apos;s no message feed to show. Ask
            your manager to add you to your store.
          </p>
        </div>
      </MyShell>
    )
  }

  return (
    <MyShell showInstagram={showInstagram}>
      <MessagesClient
        stores={stores}
        role="STAFF"
        inventoryActive={org.activeModules.includes("inventory")}
      />
    </MyShell>
  )
}
