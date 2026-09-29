import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileCheck2 } from "lucide-react"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { listDocumentCategories } from "@/lib/document-categories"
import {
  filteredTotal,
  loadSignedRecordFacets,
  loadSignedRecordsPage,
  parseSignedRecordFilters,
  signedRecordFiltersToQuery,
} from "@/lib/hr-signed-records-list"
import { SignedRecordsClient } from "./signed-records-client"

// HR-4 admin view: the executed signed records org-wide — SIGNED-1 added the
// category / document filters, the completed-date sort and "Load more". Kept
// deliberately light — the full compliance rollup (who HASN'T signed, the
// percentages, the gaps) lives at /hr/compliance (HR-8).
export default async function HrSignedRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") notFound()

  // SIGNED-1: filters, sort and paging are all server-side — see
  // lib/hr-signed-records-list.ts for why nothing is filtered in the browser.
  const filters = parseSignedRecordFilters(await searchParams)
  const [firstPage, facets, categories] = await Promise.all([
    loadSignedRecordsPage(org, filters),
    loadSignedRecordFacets(org.id),
    listDocumentCategories(org.id),
  ])

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
            Executed acknowledgment documents across the organization
          </p>
        </div>
        <Link
          href="/hr/compliance"
          className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0 mt-1"
        >
          Compliance rollup →
        </Link>
      </div>

      {facets.total === 0 ? (
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
        <SignedRecordsClient
          // Keyed by the filter, so a new filter starts from its own first page
          // instead of appending to the previous filter's loaded rows.
          key={signedRecordFiltersToQuery(filters).toString()}
          filters={filters}
          firstPage={firstPage}
          facets={facets}
          filteredTotal={filteredTotal(facets, filters)}
          categories={categories}
        />
      )}
    </div>
  )
}
