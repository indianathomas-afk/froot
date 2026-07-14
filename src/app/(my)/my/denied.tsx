import { notFound, redirect } from "next/navigation"
import { SignOutButton } from "@clerk/nextjs"
import type { StaffSelfDeniedReason } from "@/lib/auth"

// Shared denial rendering for every /my/* page. Rule 1: "terminated" is a
// hard stop with sign-out; "unavailable" behaves as though the portal does
// not exist; "no-profile" explains the data-setup miss (e.g. an admin
// browsing here) instead of 404ing.
export function MyDenied({ reason }: { reason: StaffSelfDeniedReason }) {
  if (reason === "unauthenticated") redirect("/sign-in")
  if (reason === "unavailable") notFound()

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-8">
        {reason === "terminated" ? (
          <>
            <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-2">Access has ended</h1>
            <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
              Your access to this portal is no longer active. If you believe this is a mistake, or you
              need a copy of your records, please contact your manager.
            </p>
            <SignOutButton redirectUrl="/sign-in">
              <button className="min-h-11 px-6 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium">
                Sign out
              </button>
            </SignOutButton>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-2">No staff profile linked</h1>
            <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
              Your login isn&apos;t linked to a staff profile, so there&apos;s nothing to show here. If you
              were expecting your training and documents, ask a manager to check the email on your staff
              profile.
            </p>
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center min-h-11 px-6 rounded-md border border-[var(--color-border)] text-sm font-medium text-[var(--color-foreground)]"
            >
              Back to dashboard
            </a>
          </>
        )}
      </div>
    </div>
  )
}
