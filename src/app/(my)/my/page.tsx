import Image from "next/image"
import { notFound, redirect } from "next/navigation"
import { SignOutButton } from "@clerk/nextjs"
import { GraduationCap, FileText } from "lucide-react"
import { getActiveStaffSelf } from "@/lib/auth"

// /my — HR-7 staff self-service portal (Commit 1 placeholder; /my/training
// and /my/documents land in Commit 3). Server-gated on the caller's own
// ACTIVE StaffMember — rule 1: termination denies this page immediately,
// independent of Clerk revocation.

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-8">
        {children}
      </div>
    </div>
  )
}

export default async function MyPortalPage() {
  const self = await getActiveStaffSelf()

  if (!self.ok) {
    if (self.reason === "unauthenticated") redirect("/sign-in")
    // Behave as though the feature does not exist when HR is off here.
    if (self.reason === "unavailable") notFound()
    if (self.reason === "terminated") {
      return (
        <CenterCard>
          <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-2">Access has ended</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Your access to this portal is no longer active. If you believe this is a mistake, or you need a
            copy of your records, please contact your manager.
          </p>
          <SignOutButton redirectUrl="/sign-in">
            <button className="min-h-11 px-6 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium">
              Sign out
            </button>
          </SignOutButton>
        </CenterCard>
      )
    }
    // no-profile: an org member (e.g. an admin) without a linked staff profile.
    return (
      <CenterCard>
        <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-2">No staff profile linked</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
          Your login isn&apos;t linked to a staff profile, so there&apos;s nothing to show here. If you were
          expecting your training and documents, ask a manager to check the email on your staff profile.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center justify-center min-h-11 px-6 rounded-md border border-[var(--color-border)] text-sm font-medium text-[var(--color-foreground)]"
        >
          Back to dashboard
        </a>
      </CenterCard>
    )
  }

  const { staffMember } = self

  return (
    <div className="max-w-lg mx-auto p-4 pb-12">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8">
            <Image src="/logo.png" alt="Froot" width={32} height={32} />
          </div>
          <span className="font-semibold text-[var(--color-foreground)]">froot</span>
        </div>
        <SignOutButton redirectUrl="/sign-in">
          <button className="min-h-11 px-4 rounded-md text-sm text-[var(--color-muted-foreground)]">
            Sign out
          </button>
        </SignOutButton>
      </header>

      <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-1">
        Hi, {staffMember.displayName}
      </h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        Your training and documents live here.
      </p>

      <div className="space-y-3">
        {[
          { icon: GraduationCap, title: "My Training", copy: "Assigned modules, lessons, and quizzes." },
          { icon: FileText, title: "My Documents", copy: "Handbook, policies, and required sign-offs." },
        ].map(({ icon: Icon, title, copy }) => (
          <div
            key={title}
            className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 flex items-center gap-4"
          >
            <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
              <Icon className="h-5 w-5 text-[var(--color-muted-foreground)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--color-foreground)]">{title}</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">{copy}</p>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1 uppercase tracking-wide">Coming soon</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
