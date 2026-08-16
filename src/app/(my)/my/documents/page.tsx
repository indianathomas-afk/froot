import Link from "next/link"
import { formatInstant } from "@/lib/display-time"
import { displayTimeZone } from "@/lib/hr"
import { BookOpen, CheckCircle2, ChevronRight, FileText, ShieldCheck } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { staffAudienceWhere } from "@/lib/hr-documents-access"
import { HR_RECORD_MISSING_SIGNER_COPY } from "@/lib/hr-completion"
import { Badge } from "@/components/ui/badge"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"
import { requiredDocumentRows, type MyDocumentRow } from "./data"

// /my/documents — the staff member's own required sign-offs + the reference
// library. Read + complete only (rule 3): pending documents link to the
// acknowledgment flow, completed ones show status. No signed-PDF download
// exists here (rule 5) — a manager provides a copy on request.

// R1 (Gary, 2026-08-15): only a signed record earns the green Signed badge.
// `recordMissing` is tested BEFORE the switch, because the state it names has a
// status of "in-progress" and must not be rendered as an ordinary N/M progress
// count — this signer has nothing left to do and cannot fix it themselves.
function statusBadge(row: MyDocumentRow) {
  if (row.recordMissing) return <Badge variant="warning">{HR_RECORD_MISSING_SIGNER_COPY}</Badge>
  switch (row.status) {
    case "signed":
      return <Badge variant="success">Signed</Badge>
    case "needs-current":
      return <Badge variant="warning">New version to sign</Badge>
    case "in-progress":
      return <Badge variant="info">{`In progress ${row.ackedCount}/${row.requiredCount}`}</Badge>
    default:
      return <Badge variant="secondary">Not started</Badge>
  }
}

export default async function MyDocumentsPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { staffMember, org } = self
  // DEBT-70b: the day THIS person lived — their primary store's zone, else
  // the org's. Resolved once per render through the one shared chain.
  const zone = displayTimeZone(staffMember, org)

  const [rows, signedRecords, referenceDocs, sharedDocs] = await Promise.all([
    requiredDocumentRows(staffMember),
    // STAFF-1 (F4): every executed record this person holds — all versions and
    // signing cycles (a rehire's records coexist) — viewable inline, never
    // downloadable from here.
    prisma.hrSignedRecord.findMany({
      where: {
        staffMemberId: staffMember.id,
        version: { hrDocument: { organizationId: org.id } },
      },
      include: {
        version: { select: { versionNumber: true, hrDocument: { select: { title: true } } } },
      },
      orderBy: { completedAt: "desc" },
    }),
    // DOC-1 A: the reference library was org-wide and unfiltered here — every
    // Reference document in the org, to every active staff member. It is now
    // the staff member's own audience, the same rule the To-sign list above
    // uses, so the two halves of this page cannot disagree about what reaches
    // this person.
    prisma.hrDocument.findMany({
      where: {
        organizationId: org.id,
        kind: "Reference",
        isActive: true,
        ...staffAudienceWhere(staffMember),
      },
      select: { id: true, title: true, category: true },
      orderBy: { title: "asc" },
    }),
    // HR-7.6: manager-uploaded documents a manager chose to share with this
    // staff member. Not-visible uploads are never fetched here.
    prisma.staffDocument.findMany({
      where: { staffMemberId: staffMember.id, organizationId: org.id, visibleToStaff: true },
      select: { id: true, title: true, category: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // R1: ONE PREDICATE DECIDES BOTH BUCKETS, and it is the record. The old pair
  // tested two statuses each and drifted the moment "pending-record" was added
  // to both sides — which is how a document with no signature reached Completed
  // AND cleared the TO SIGN list, so the signer was told they were finished and
  // would never be prompted again.
  const pending = rows.filter((r) => r.status !== "signed")
  const done = rows.filter((r) => r.status === "signed")

  return (
    <MyShell showInstagram={!!org.instagramEnabled && !!org.instagramAccessToken}>
      <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-4">My Documents</h1>

      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
        To sign
      </h2>
      {pending.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 text-center mb-6">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-[var(--color-success,#25ba3b)]" />
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {rows.length === 0 ? "Nothing needs your signature yet." : "All caught up — nothing to sign."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {pending.map((row) => (
            <Link
              key={row.documentId}
              href={`/my/documents/${row.documentId}`}
              className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
            >
              <FileText className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
                <div className="mt-1">{statusBadge(row)}</div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
            </Link>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Completed
          </h2>
          <div className="space-y-2 mb-6">
            {done.map((row) => (
              <div
                key={row.documentId}
                className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4"
              >
                <FileText className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
                  {/* ── R2: ONE STATEMENT, BOTH FACTS, ONE LINK ───────────────
                      Ruled 2026-08-15; collapsed 2026-08-16. The notice shipped
                      as a SECOND paragraph beneath this one, so an R2 row said
                      "Signed v5" twice in stacked lines — the notice was added
                      alongside the existing copy instead of replacing it.

                      signedVersionNumber, NOT currentVersionNumber: this was
                      hardcoded to the current version, harmless while only a
                      current-version record could reach this section and a lie
                      the moment R2 lets a v5 signer land here.

                      THE LINK IS THE AUDIENCE-AWARE DOWNLOAD ROUTE, exactly as
                      the Library below uses it, and that is the whole point of
                      the choice. The only per-document route in this portal is
                      /my/documents/[documentId], which IS the ceremony: it
                      renders SigningClient and computes hasSignedRecord against
                      the CURRENT version — which a signer in this state does not
                      have — so that link would open a signing ceremony for the
                      exact person the ruling says must never be prompted. The
                      defect R2 exists to remove, reintroduced by the notice
                      announcing it. No button, no badge change, no ceremony. */}
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    Signed v{row.signedVersionNumber ?? row.currentVersionNumber}
                    {row.completedAt && ` · ${formatInstant(row.completedAt, zone, "medium")}`}
                    {row.signedOnEarlierVersion ? (
                      <>
                        {" "}
                        — an updated version is available to read.{" "}
                        <a
                          href={`/api/hr/documents/${row.documentId}/download`}
                          target="_blank"
                          rel="noopener"
                          className="font-medium text-[var(--color-primary)] underline"
                        >
                          View v{row.currentVersionNumber}
                        </a>{" "}
                        · Need a copy? Ask your manager.
                      </>
                    ) : (
                      <> — need a copy? Ask your manager.</>
                    )}
                  </p>
                </div>
                {statusBadge(row)}
              </div>
            ))}
          </div>
        </>
      )}

      {signedRecords.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Signed records
          </h2>
          <div className="space-y-2 mb-6">
            {signedRecords.map((r) => (
              <Link
                key={r.id}
                href={`/my/documents/records/${r.id}`}
                className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
              >
                <ShieldCheck className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-foreground)] truncate">
                    {r.version.hrDocument.title}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    Version {r.version.versionNumber} · signed {formatInstant(r.completedAt, zone, "mediumDot")}
                  </p>
                </div>
                <span className="text-xs font-medium text-[var(--color-primary)] shrink-0">View</span>
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
              </Link>
            ))}
          </div>
        </>
      )}

      {sharedDocs.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Shared with you
          </h2>
          <div className="space-y-2 mb-6">
            {sharedDocs.map((doc) => (
              <a
                key={doc.id}
                href={`/api/staff/${staffMember.id}/documents/${doc.id}/download`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
              >
                <FileText className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-foreground)] truncate">{doc.title}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {doc.category ? `${doc.category} · ` : ""}
                    {formatInstant(doc.createdAt, zone, "medium")}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
        Library
      </h2>
      {referenceDocs.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No reference documents yet.</p>
      ) : (
        <div className="space-y-2">
          {referenceDocs.map((doc) => (
            <a
              key={doc.id}
              href={`/api/hr/documents/${doc.id}/download`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
            >
              <BookOpen className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--color-foreground)] truncate">{doc.title}</p>
                {doc.category && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{doc.category}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </MyShell>
  )
}
