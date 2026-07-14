import Link from "next/link"
import { ChevronRight, FileText, GraduationCap } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { MyShell } from "./my-shell"
import { MyDenied } from "./denied"
import { requiredDocumentRows } from "./documents/data"

// /my — HR-7 staff self-service portal home. Rule 3: everything on this page
// is the session's own staff profile; nothing accepts an id from the client.
export default async function MyPortalPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { staffMember } = self

  const [assignments, docRows] = await Promise.all([
    prisma.trainingAssignment.findMany({
      where: { staffMemberId: staffMember.id },
      select: { status: true, certifiedAt: true },
    }),
    requiredDocumentRows(staffMember),
  ])

  const trainingDone = assignments.filter((a) => a.status === "Completed").length
  const docsDone = docRows.filter((d) => d.status === "signed" || d.status === "pending-record").length
  const docsPending = docRows.length - docsDone

  return (
    <MyShell>
      <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-1">
        Hi, {staffMember.displayName}
      </h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        Your training and documents live here.
      </p>

      <div className="space-y-3">
        <Link
          href="/my/training"
          className="flex items-center gap-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5 min-h-11"
        >
          <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-[var(--color-foreground)]">My Training</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {assignments.length === 0
                ? "Nothing assigned yet"
                : `${trainingDone}/${assignments.length} module${assignments.length !== 1 ? "s" : ""} complete`}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>

        <Link
          href="/my/documents"
          className="flex items-center gap-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5 min-h-11"
        >
          <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-[var(--color-foreground)]">My Documents</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {docRows.length === 0
                ? "Nothing to sign yet"
                : docsPending > 0
                  ? `${docsPending} document${docsPending !== 1 ? "s" : ""} need${docsPending === 1 ? "s" : ""} your signature`
                  : "All sign-offs complete"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>
      </div>
    </MyShell>
  )
}
