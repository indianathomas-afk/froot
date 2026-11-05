import TemplatesClient from "./templates-client"

// PERM-5C. The requireAdmin() that stood here was a SECOND guard: templates/
// layout.tsx already asks can(actor, "templates.manage") and wraps every
// /templates/* route including this one, so this check could only ever agree
// with it. Leaving it as requireAdmin would have been worse than redundant —
// it would have been the one guard on the templates surface that ignores the
// override layer, and the /templates page would keep rendering for a user the
// layout had already decided to bounce. Deleted rather than converted: one
// guard, in the layout, is the whole point of putting it there.
//
// TPL-3 (F3): `?retired=N` is set by the template form after a save that
// retired N tasks (deleted tasks with completion history). Read here rather
// than with useSearchParams so the client needs no Suspense boundary.
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const raw = (await searchParams).retired
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  const retiredNotice = Number.isInteger(n) && n > 0 ? n : null
  return <TemplatesClient retiredNotice={retiredNotice} />
}
