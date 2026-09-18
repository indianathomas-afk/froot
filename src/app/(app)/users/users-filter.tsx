"use client"

import { useState, type ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"

// UM-3. Same sentinel and the same "All locations" label as the /staff filter
// (staff-location-filter.tsx :14, :66), which took both verbatim from the
// Dashboard's store selector. The PATTERN and the STRING are reused; the
// STORAGE is deliberately not — no localStorage, no URL param, no shared key,
// so picking a location here cannot silently narrow any other surface. Plain
// component state that resets on reload. UX-2 unifies the selector sites; this
// is a NEW SITE for it to absorb, not a pre-emption of it.
const ALL_STORES = "all"

/**
 * A row as this component sees it: the filter keys, and the ALREADY-RENDERED
 * SERVER NODE that is put on screen unchanged when it matches.
 *
 * The node is the reason this shape was chosen over receiving the `members`
 * and `pendingInvites` arrays themselves. Every `<tr>` — chips, role badge,
 * the "Device at X" badge, the date, and the Edit / Remove / Revoke buttons —
 * is still built by the same server code that built it before this component
 * existed, so the action buttons keep working on filtered rows for the same
 * reason they worked before. What crosses the client boundary is only what the
 * two controls actually read: a name, an email, and store ids. The full
 * `storeAssignments` carry whole Store records (contactEmail, Square ids) and
 * the members carry their capability arrays; none of that is needed to filter,
 * so none of it is sent.
 */
export type UserFilterRow = {
  id: string
  /** The name slot AS RENDERED — which for a device account is its email. */
  name: string
  email: string
  storeIds: string[]
  /**
   * ADMIN. Matches EVERY location selection, because that is their actual
   * access: an ADMIN has no storeAssignments by design and the row says so in
   * words ("All locations"). Filtering on assignments alone would hide exactly
   * the people who can see every location.
   */
  allLocations: boolean
  node: ReactNode
}

/**
 * Holds the location selection and the search text.
 *
 * IT OWNS NO ROW RENDERING OF ITS OWN. `heading`, `subtitle`, `actions` and
 * every `node` arrive as already-rendered server nodes and are passed straight
 * through. The only reason this is a client component is that the selection
 * spans two places in the layout: the controls under the subtitle, and the
 * table below them.
 */
export function UsersFilter({
  heading,
  subtitle,
  actions,
  stores,
  countPrefix,
  memberRows,
  inviteRows,
}: {
  heading: ReactNode
  subtitle: ReactNode
  actions: ReactNode
  stores: { id: string; name: string; storeNumber: string | null }[]
  /** The org totals, built on the server. Filtering never changes them. */
  countPrefix: string
  memberRows: UserFilterRow[]
  inviteRows: UserFilterRow[]
}) {
  const [storeId, setStoreId] = useState(ALL_STORES)
  const [search, setSearch] = useState("")

  const isAll = storeId === ALL_STORES
  const query = search.trim().toLowerCase()
  const filterActive = !isAll || query.length > 0

  const matches = (row: UserFilterRow) => {
    const atLocation = isAll || row.allLocations || row.storeIds.includes(storeId)
    const named = !query || row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query)
    return atLocation && named
  }

  const visibleMembers = filterActive ? memberRows.filter(matches) : memberRows
  const visibleInvites = filterActive ? inviteRows.filter(matches) : inviteRows

  // Header counts stay the ORG TOTALS — they answer "how big is this
  // organization", which a filter does not change. The filtered number is
  // appended rather than substituted, and only for the members.
  const countLine = filterActive ? `${countPrefix} · showing ${visibleMembers.length}` : countPrefix

  return (
    <>
      <div className="flex items-start justify-between mb-8">
        <div>
          {heading}
          {subtitle}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STORES}>All locations</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.storeNumber ? `#${s.storeNumber} — ` : ""}
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search by name or email"
            />
          </div>
        </div>
        {actions}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-medium text-[var(--color-foreground)]">Organization Members</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{countLine}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["User", "Role", "Location Access", "Invited", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((r) => r.node)}
              {/* Deliberately NOT the empty-org state: an org with members that
                  this filter happens to exclude has not become an empty org,
                  and offering "invite your team to get started" would answer a
                  question nobody asked. */}
              {memberRows.length > 0 && visibleMembers.length === 0 && (
                <tr className="border-b border-[var(--color-border)] last:border-0">
                  <td colSpan={5} className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">No matches</td>
                </tr>
              )}
              {visibleInvites.map((r) => r.node)}
              {inviteRows.length > 0 && visibleInvites.length === 0 && (
                <tr className="border-b border-[var(--color-border)] last:border-0 bg-[var(--color-accent)]/10">
                  <td colSpan={5} className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">No matches</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
