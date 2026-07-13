import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import { BriefcaseBusiness } from "lucide-react"
import Link from "next/link"
import { hrModuleAvailable } from "@/lib/auth"

// HR-0 scaffolding: availability gate first (env flag / internal-org
// allowlist), then the per-org activeModules toggle. While unavailable this
// page must behave as though HR does not exist — notFound(), not an upsell.
export default async function HrPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")

  if (!hrModuleAvailable(orgId)) notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("hr")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <BriefcaseBusiness className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">HR, Training &amp; Compliance</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Employee handbooks, e-signature acknowledgments, agreement forms, manager notes, and trackable
            training — enable the HR add-on to unlock this page.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">HR, Training &amp; Compliance</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Documents, acknowledgments, manager notes, and training
        </p>
      </div>
      <div className="flex items-center justify-center min-h-[40vh] border border-dashed border-[var(--color-border)] rounded-lg">
        <div className="text-center max-w-md px-6">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <BriefcaseBusiness className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">HR module — coming online</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Employee documents, e-signature acknowledgments, manager notes, and trackable training will appear
            here as they roll out.
          </p>
        </div>
      </div>
    </div>
  )
}
