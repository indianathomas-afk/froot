import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, Download, FileCheck2 } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"

// HR-4 admin view: the most recent executed signed records org-wide. Kept
// deliberately light — the full compliance rollup (who HASN'T signed, the
// percentages, the gaps) lives at /hr/compliance (HR-8).
export default async function HrSignedRecordsPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") notFound()

  const records = await prisma.hrSignedRecord.findMany({
    where: { version: { hrDocument: { organizationId: org.id } } },
    include: {
      version: { select: { versionNumber: true, hrDocument: { select: { title: true } } } },
      staffMember: { select: { id: true, displayName: true, fullName: true } },
    },
    orderBy: { completedAt: "desc" },
    take: 50,
  })

  return (
    <div>
      <Link
        href="/hr"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        HR
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Signed Records</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            The 50 most recent executed acknowledgment documents across the organization
          </p>
        </div>
        <Link
          href="/hr/compliance"
          className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0 mt-1"
        >
          Compliance rollup →
        </Link>
      </div>

      {records.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh] border border-dashed border-[var(--color-border)] rounded-lg">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
              <FileCheck2 className="h-6 w-6 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">No signed records yet</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              When a team member completes every checkpoint of a signature document, the executed
              record lands here automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
          {records.map((r) => (
            <div key={r.id} className="flex items-center gap-4 p-4">
              <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                <FileCheck2 className="h-4 w-4 text-[var(--color-primary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                  <Link href={`/staff/${r.staffMember.id}`} className="hover:underline">
                    {r.staffMember.fullName ?? r.staffMember.displayName}
                  </Link>{" "}
                  · {r.version.hrDocument.title} v{r.version.versionNumber}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  Completed {format(r.completedAt, "MMM d, yyyy h:mm a")} ·{" "}
                  <span className="font-mono" title={`sha256 ${r.signedPdfHash}`}>
                    sha256 {r.signedPdfHash.slice(0, 12)}…
                  </span>
                </p>
              </div>
              <a
                href={`/api/hr/signed-records/${r.id}/download`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
