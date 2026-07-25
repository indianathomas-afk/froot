import Link from "next/link"
import { ShieldAlert } from "lucide-react"

// Shown in place of the signing ceremony when a team member has no legal Full
// Name. Signed documents and the Certificate of Acknowledgment carry the Full
// Name only (never the operational Display Name), so signing is blocked until
// an admin/manager sets it. `manageHref` links there for admins; staff signers
// get an "ask your admin" message instead.
export function LegalNameRequired({
  staffName,
  manageHref,
}: {
  staffName: string
  manageHref?: string
}) {
  return (
    <div className="max-w-xl mx-auto">
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-warning,#efa201)]/15 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-[var(--color-warning,#efa201)]" />
        </div>
        <h1 className="text-lg font-bold text-[var(--color-foreground)] mb-2">Legal name required</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
          {staffName} needs a legal <span className="font-medium text-[var(--color-foreground)]">Full Name</span> on
          their staff profile before this document can be signed. The Full Name is what appears on the
          signed document and the Certificate of Acknowledgment — the operational Display Name is never
          used for signatures.
        </p>
        {manageHref ? (
          <Link
            href={manageHref}
            className="inline-flex items-center mt-5 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Set the Full Name
          </Link>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)] mt-4">
            Ask an admin or manager to add it, then reload this page.
          </p>
        )}
      </div>
    </div>
  )
}
