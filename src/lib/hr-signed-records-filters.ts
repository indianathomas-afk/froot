// SIGNED-1. The /hr/signed-records filter state as it travels in the query
// string (`category`, `document`, `sort`). Pure — no Prisma — so the client
// component builds URLs with the same code the server parses them with. The
// query itself lives in lib/hr-signed-records-list.ts.

// The `category` query value for documents with no category (categoryId null).
export const UNCATEGORIZED_FILTER = "uncategorized"

export type SignedRecordSort = "newest" | "oldest"

export type SignedRecordFilters = {
  category: string | null // category id, UNCATEGORIZED_FILTER, or null for all
  document: string | null // HrDocument id, or null for all
  sort: SignedRecordSort
}

type RawParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v
  return s && s.trim() ? s.trim() : null
}

// Unknown ids are passed through, not rejected: the organizationId in the
// `where` already turns a foreign or stale id into an empty result.
export function parseSignedRecordFilters(params: RawParams): SignedRecordFilters {
  return {
    category: first(params.category),
    document: first(params.document),
    sort: first(params.sort) === "oldest" ? "oldest" : "newest",
  }
}

// The same three keys, back into a query string (defaults omitted).
export function signedRecordFiltersToQuery(f: SignedRecordFilters): URLSearchParams {
  const q = new URLSearchParams()
  if (f.category) q.set("category", f.category)
  if (f.document) q.set("document", f.document)
  if (f.sort === "oldest") q.set("sort", "oldest")
  return q
}
