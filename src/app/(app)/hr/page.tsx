import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import { BriefcaseBusiness, FileCheck2, FileSignature, FileText, Gauge, GraduationCap, Users } from "lucide-react"
import Link from "next/link"
import { hrModuleAvailable } from "@/lib/auth"

// HR-0 scaffolding: availability gate first (env flag / internal-org
// allowlist), then the per-org activeModules toggle. While unavailable this
// page must behave as though HR does not exist — notFound(), not an upsell.
export default async function HrPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  if (!hrModuleAvailable(orgId)) notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  const dbUser = userId
    ? await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { role: true } })
    : null

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* HR-24 ROW #1 (training access audit §2.4, triage #2): this card used
            to render for EVERYONE, and /staff requires staff.view (MANAGE) — so
            a STORE login on the shared iPad tapped it and bounced, as did a
            STAFF login reaching /hr by URL (the sidebar sends STAFF to
            /my/documents, but this page has no role gate of its own). One
            condition closes both, and it matches staff.view's tier exactly. */}
        {(dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER") && (
          <Link
            href="/staff"
            className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
          >
            <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Staff Directory</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Team roster, profiles, and manager notes
            </p>
          </Link>
        )}
        <Link
          href="/hr/documents"
          className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
        >
          <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Document Library</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
            Handbooks, policies, and reference documents for the whole team
          </p>
        </Link>
        {(dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER") && (
          <Link
            href="/hr/compliance"
            className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
          >
            <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
              <Gauge className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Compliance</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Who is compliant, who is not, and where the gaps are — per store and per employee
            </p>
          </Link>
        )}
        {dbUser?.role === "ADMIN" && (
          <Link
            href="/hr/forms"
            className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
          >
            <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
              <FileSignature className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Agreement Forms</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Fillable key &amp; pay agreements signed by staff and supervisor
            </p>
          </Link>
        )}
        {/* HR-24: STORE joins ADMIN here — the card is the first of the three
            gates a STORE login must pass to reach the library (card, page,
            data route). The copy branches because the surfaces genuinely
            differ: ADMIN gets the builder, STORE gets a reading surface.
            MANAGER is deliberately unchanged (settled item 6 — MANAGER page
            access is its own future row). */}
        {(dbUser?.role === "ADMIN" || dbUser?.role === "STORE") && (
          <Link
            href="/hr/training"
            className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
          >
            <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Training</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              {dbUser?.role === "ADMIN"
                ? "Build lesson-based training modules with videos, files, and quizzes"
                : "Read the training modules for your store — procedures, lessons, and videos"}
            </p>
          </Link>
        )}
        {dbUser?.role === "ADMIN" && (
          <Link
            href="/hr/signed-records"
            className="border border-[var(--color-border)] rounded-lg p-5 bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 transition-colors"
          >
            <div className="w-10 h-10 mb-3 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
              <FileCheck2 className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Signed Records</h2>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Recent executed acknowledgments across the organization
            </p>
          </Link>
        )}
      </div>
    </div>
  )
}
