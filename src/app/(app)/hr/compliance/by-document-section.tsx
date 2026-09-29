"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CategoryFilterChip,
  DocumentCategoryChip,
  FilterChip,
  UNCATEGORIZED_LABEL,
  type DocumentCategoryOption,
} from "@/components/hr/document-category"
import { UNCATEGORIZED_FILTER } from "@/lib/hr-signed-records-filters"
import type {
  DocumentCompliancePerson,
  DocumentComplianceRow,
  DocumentComplianceView,
} from "@/lib/hr-compliance"

// DOC-2: By Document. Everything here is already computed server-side for
// this page's scope (lib/hr-compliance.ts, pivotComplianceByDocument), so the
// controls filter in memory and write the URL with history.replaceState rather
// than navigating — a navigation would recompute the whole rollup to change a
// filter over data the page already holds.

// Radix Select cannot carry an empty-string value.
const ALL_DOCUMENTS = "__all__"

export type ByDocumentFilters = {
  category: string | null // category id, UNCATEGORIZED_FILTER, or null for all
  document: string | null
  outstanding: boolean // default on; `outstanding=0` in the URL turns it off
}

export function ByDocumentSection({
  view,
  categories,
  initial,
  scopeLabel,
}: {
  view: DocumentComplianceView
  categories: DocumentCategoryOption[]
  initial: ByDocumentFilters
  scopeLabel: string
}) {
  const [filters, setFilters] = useState<ByDocumentFilters>(initial)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initial.document ? [initial.document] : [])
  )
  const sectionRef = useRef<HTMLDivElement>(null)

  // A deep link (?document=<id>) from the Library or the document page lands
  // here, not at the top of the KPI cards.
  useEffect(() => {
    if (initial.document) sectionRef.current?.scrollIntoView({ block: "start" })
  }, [initial.document])

  function apply(next: ByDocumentFilters) {
    setFilters(next)
    if (next.document) setExpanded((prev) => new Set(prev).add(next.document!))
    const q = new URLSearchParams(window.location.search)
    for (const [k, v] of [
      ["category", next.category],
      ["document", next.document],
      ["outstanding", next.outstanding ? null : "0"],
    ] as const) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    const qs = q.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }

  const keyOf = (d: DocumentComplianceRow) => d.categoryId ?? UNCATEGORIZED_FILTER
  const inCategory = (d: DocumentComplianceRow, c: string | null) => c === null || keyOf(d) === c

  // Picking a category keeps the chosen document only if it is IN that category
  // (SIGNED-1's rule).
  function pickCategory(category: string | null) {
    const doc = view.documents.find((d) => d.documentId === filters.document)
    const keep = doc && inCategory(doc, category)
    apply({ ...filters, category, document: keep ? filters.document : null })
  }

  const countFor = (key: string) => view.documents.filter((d) => keyOf(d) === key).length
  const uncategorizedCount = countFor(UNCATEGORIZED_FILTER)
  const documentOptions = view.documents.filter((d) => inCategory(d, filters.category))
  const shown = filters.document
    ? view.documents.filter((d) => d.documentId === filters.document)
    : documentOptions
  // A deep link to a document that isn't counted (zero audience, archived, not
  // a signature document, or nobody in scope) gets said so, not a blank list.
  const missingDocument = filters.document !== null && shown.length === 0

  const excludedNote = [
    view.unassignedExcluded > 0 &&
      `${view.unassignedExcluded} ${plural(view.unassignedExcluded, "document has", "documents have")} no audience yet and ${view.unassignedExcluded === 1 ? "isn't" : "aren't"} listed — look for the Unassigned chip in the Document Library.`,
    view.unreachedExcluded > 0 &&
      `${view.unreachedExcluded} more ${plural(view.unreachedExcluded, "applies", "apply")} to nobody currently active ${scopeLabel}.`,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      ref={sectionRef}
      id="by-document"
      className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-8 scroll-mt-4"
    >
      <div className="px-6 py-4 border-b border-[var(--color-border)]">
        <h2 className="font-semibold text-[var(--color-foreground)]">By Document</h2>
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
          Who has signed each document and who still owes it. Signature documents only — training is
          counted per person below.
        </p>
      </div>

      <div className="px-6 py-4 border-b border-[var(--color-border)] space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterChip active={filters.category === null} onClick={() => pickCategory(null)}>
            All ({view.documents.length})
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

        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-72 max-w-full">
            <Select
              value={filters.document ?? ALL_DOCUMENTS}
              onValueChange={(v) => apply({ ...filters, document: v === ALL_DOCUMENTS ? null : v })}
            >
              <SelectTrigger aria-label="Document">
                <SelectValue placeholder="All documents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DOCUMENTS}>All documents</SelectItem>
                {documentOptions.map((d) => (
                  <SelectItem key={d.documentId} value={d.documentId}>
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-foreground)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filters.outstanding}
              onChange={(e) => apply({ ...filters, outstanding: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Outstanding only
          </label>
        </div>
      </div>

      {missingDocument ? (
        <div className="px-6 py-6 text-sm text-[var(--color-muted-foreground)]">
          <p>
            That document isn&apos;t counted here — it has no audience {scopeLabel}, is archived, or
            isn&apos;t a signature document.
          </p>
          <button
            onClick={() => apply({ ...filters, document: null })}
            className="mt-2 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
          >
            Show all documents
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="px-6 py-6 text-sm text-[var(--color-muted-foreground)]">
          <p>No signature documents apply to anyone {scopeLabel} in this category.</p>
          <Link
            href="/hr/documents"
            className="mt-2 inline-block text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
          >
            Open the Document Library to assign one
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {shown.map((d) => (
            <DocumentRow
              key={d.documentId}
              doc={d}
              open={expanded.has(d.documentId)}
              outstandingOnly={filters.outstanding}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(d.documentId)) next.delete(d.documentId)
                  else next.add(d.documentId)
                  return next
                })
              }
            />
          ))}
        </ul>
      )}

      {excludedNote && (
        <p className="px-6 py-3 border-t border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
          {excludedNote}
        </p>
      )}
    </div>
  )
}

function DocumentRow({
  doc,
  open,
  outstandingOnly,
  onToggle,
}: {
  doc: DocumentComplianceRow
  open: boolean
  outstandingOnly: boolean
  onToggle: () => void
}) {
  const pct = doc.audienceCount > 0 ? Math.round((doc.signedCount / doc.audienceCount) * 100) : 0
  const outstanding = doc.audienceCount - doc.signedCount
  const people = outstandingOnly ? doc.people.filter((p) => p.status !== "complete") : doc.people

  // Grouped by store in first-appearance order of a name sort, then each
  // group's people keep the pivot's order (outstanding first, then name).
  const groups = new Map<string, { name: string; people: DocumentCompliancePerson[] }>()
  for (const p of [...people].sort((a, b) => a.groupName.localeCompare(b.groupName))) {
    const key = p.groupId ?? "__none__"
    if (!groups.has(key)) groups.set(key, { name: p.groupName, people: [] })
    groups.get(key)!.people.push(p)
  }

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-[var(--color-accent)]/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[var(--color-foreground)]">{doc.title}</span>
            <DocumentCategoryChip
              name={doc.categoryId ? doc.categoryName : null}
              colorKey={doc.categoryColorKey}
            />
            <span className="text-xs text-[var(--color-muted-foreground)]">v{doc.currentVersionNumber}</span>
          </div>
        </div>
        <div className="w-40 shrink-0">
          <p className="text-sm text-right text-[var(--color-foreground)]">
            <span className="font-semibold">{doc.signedCount}</span> of {doc.audienceCount} signed
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-[var(--color-muted)] overflow-hidden">
            <div
              className={`h-full rounded-full ${pct === 100 ? "bg-[#25ba3b]" : "bg-[#efa201]"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </button>

      {open && (
        <div className="px-6 pb-4 pl-14">
          {people.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {outstanding === 0 ? "Everyone has signed." : "Nobody to show."}
            </p>
          ) : (
            <div className="space-y-3">
              {[...groups.values()].map((g) => (
                <div key={g.name}>
                  <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
                    {g.name}
                  </p>
                  <ul className="space-y-1">
                    {g.people.map((p) => (
                      <li key={p.staffId} className="flex items-center justify-between gap-3 text-sm">
                        <Link
                          href={`/staff/${p.staffId}`}
                          className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline truncate"
                        >
                          {p.name}
                        </Link>
                        <StatusBadge person={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// The four statuses a document item can carry (training's "overdue" never
// reaches a document). Wording follows the per-person Compliance tab: R2's
// earlier-version signer is green "Signed vN", never amber.
function StatusBadge({ person: p }: { person: DocumentCompliancePerson }) {
  const base = "inline-block text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
  switch (p.status) {
    case "complete":
      return (
        <span className={`${base} bg-[#25ba3b]/10 text-[var(--color-success-text,#1d7c2e)]`}>
          Signed{p.signedOnEarlierVersion && p.signedVersionNumber !== null ? ` v${p.signedVersionNumber}` : ""}
        </span>
      )
    case "in-progress":
      return (
        <span className={`${base} bg-[#0081f2]/10 text-[var(--color-info-text,#005bb0)]`}>
          {p.recordMissing
            ? "All checkpoints done · record missing"
            : `In progress · ${p.ackedCount} of ${p.requiredCount}`}
        </span>
      )
    case "needs-resign":
      return (
        <span className={`${base} bg-[#efa201]/10 text-[var(--color-warning-text,#a36a00)]`}>
          Needs re-sign
        </span>
      )
    default:
      return (
        <span className={`${base} bg-[var(--color-muted)] text-[var(--color-muted-foreground)]`}>
          Not started
        </span>
      )
  }
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}
