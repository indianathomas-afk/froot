"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, FileCheck2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CategoryFilterChip,
  DocumentCategoryChip,
  FilterChip,
  UNCATEGORIZED_LABEL,
  type DocumentCategoryOption,
} from "@/components/hr/document-category"
import {
  UNCATEGORIZED_FILTER,
  signedRecordFiltersToQuery,
  type SignedRecordFilters,
} from "@/lib/hr-signed-records-filters"
import type {
  SignedRecordFacets,
  SignedRecordRow,
  SignedRecordsPage,
} from "@/lib/hr-signed-records-list"

// SIGNED-1. Every control rewrites the URL (`category`, `document`, `sort`) and
// the server re-queries; nothing here filters rows. The page keys this
// component by the filter, so rows loaded with "Load more" belong to exactly
// one filter and reset when it changes.

// Radix Select cannot carry an empty-string value.
const ALL_DOCUMENTS = "__all__"

export function SignedRecordsClient({
  filters,
  firstPage,
  facets,
  filteredTotal,
  categories,
}: {
  filters: SignedRecordFilters
  firstPage: SignedRecordsPage
  facets: SignedRecordFacets
  filteredTotal: number
  categories: DocumentCategoryOption[]
}) {
  const router = useRouter()
  const [navigating, startNavigation] = useTransition()
  const [rows, setRows] = useState<SignedRecordRow[]>(firstPage.rows)
  const [cursor, setCursor] = useState<string | null>(firstPage.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")

  function go(next: SignedRecordFilters) {
    const q = signedRecordFiltersToQuery(next).toString()
    startNavigation(() => router.push(q ? `/hr/signed-records?${q}` : "/hr/signed-records", { scroll: false }))
  }

  // Picking a category keeps the chosen document only if it is IN that category.
  function pickCategory(category: string | null) {
    const doc = facets.documents.find((d) => d.id === filters.document)
    const keep = doc && inCategory(doc.categoryId, category)
    go({ ...filters, category, document: keep ? filters.document : null })
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    setError("")
    try {
      const q = signedRecordFiltersToQuery(filters)
      q.set("cursor", cursor)
      const res = await fetch(`/api/hr/signed-records?${q}`)
      if (!res.ok) throw new Error()
      const page: SignedRecordsPage = await res.json()
      setRows((prev) => [...prev, ...page.rows])
      setCursor(page.nextCursor)
    } catch {
      setError("Couldn't load more records. Try again.")
    } finally {
      setLoadingMore(false)
    }
  }

  const countFor = (key: string) => facets.categoryCounts[key] ?? 0
  const uncategorizedCount = countFor(UNCATEGORIZED_FILTER)
  const documentOptions = facets.documents.filter((d) => inCategory(d.categoryId, filters.category))

  return (
    <div className={navigating ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* Category chips — the Document Library's shape (DOC-5). Counts are
          record counts from the server, not from the rows loaded below. */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <FilterChip active={filters.category === null} onClick={() => pickCategory(null)}>
          All ({facets.total})
        </FilterChip>
        {categories.map((c) => (
          <CategoryFilterChip
            key={c.id}
            active={filters.category === c.id}
            colorKey={c.colorKey}
            onClick={() => pickCategory(filters.category === c.id ? null : c.id)}
          >
            {c.name} ({countFor(c.id)})
          </CategoryFilterChip>
        ))}
        {(uncategorizedCount > 0 || filters.category === UNCATEGORIZED_FILTER) && (
          <CategoryFilterChip
            active={filters.category === UNCATEGORIZED_FILTER}
            colorKey={null}
            onClick={() =>
              pickCategory(filters.category === UNCATEGORIZED_FILTER ? null : UNCATEGORIZED_FILTER)
            }
          >
            {UNCATEGORIZED_LABEL} ({uncategorizedCount})
          </CategoryFilterChip>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="w-72 max-w-full">
          <Select
            value={filters.document ?? ALL_DOCUMENTS}
            onValueChange={(v) => go({ ...filters, document: v === ALL_DOCUMENTS ? null : v })}
          >
            <SelectTrigger aria-label="Document">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DOCUMENTS}>All documents</SelectItem>
              {documentOptions.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                  {d.isActive ? "" : " (archived)"} ({d.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden" role="group" aria-label="Sort by completed date">
          {(["newest", "oldest"] as const).map((s) => (
            <button
              key={s}
              onClick={() => filters.sort !== s && go({ ...filters, sort: s })}
              aria-pressed={filters.sort === s}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.sort === s
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                  : "bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
              }`}
            >
              {s === "newest" ? "Newest first" : "Oldest first"}
            </button>
          ))}
        </div>

        <p className="text-sm text-[var(--color-muted-foreground)] ml-auto">
          Showing {rows.length} of {filteredTotal}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center min-h-[30vh] border border-dashed border-[var(--color-border)] rounded-lg">
          <div className="text-center max-w-md px-6">
            <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">No records match</h2>
            <p className="text-sm text-[var(--color-muted-foreground)] mb-3">
              Nobody has completed a document in this filter yet. Records appear here as soon as a
              team member signs every checkpoint.
            </p>
            <button
              onClick={() => go({ category: null, document: null, sort: filters.sort })}
              className="text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
            >
              Show all records
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-4 p-4">
              <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                <FileCheck2 className="h-4 w-4 text-[var(--color-primary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                  <Link href={`/staff/${r.staffMemberId}`} className="hover:underline">
                    {r.staffName}
                  </Link>{" "}
                  · {r.documentTitle} v{r.versionNumber}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  Completed {r.completedLabel} ·{" "}
                  <span className="font-mono" title={`sha256 ${r.signedPdfHash}`}>
                    sha256 {r.signedPdfHash.slice(0, 12)}…
                  </span>
                </p>
              </div>
              <div className="shrink-0 hidden sm:block">
                <DocumentCategoryChip name={r.categoryName} colorKey={r.categoryColorKey} />
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

      {cursor && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-60 transition-colors"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>
      )}
    </div>
  )
}

function inCategory(categoryId: string | null, filter: string | null): boolean {
  if (filter === null) return true
  if (filter === UNCATEGORIZED_FILTER) return categoryId === null
  return categoryId === filter
}
