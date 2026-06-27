import { Sidebar } from "@/components/layout/sidebar"
import { auth } from "@clerk/nextjs/server"
import { OrganizationList } from "@clerk/nextjs"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth()

  if (!orgId) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">🍊</div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-2">Welcome to Froot</h1>
          <p className="text-[var(--color-muted-foreground)] mb-8">Create or select an organization to get started.</p>
          <OrganizationList
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-[190px] min-h-screen bg-[var(--color-background)]">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
