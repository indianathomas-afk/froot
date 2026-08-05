import TemplatesClient from "./templates-client"

// PERM-5C. The requireAdmin() that stood here was a SECOND guard: templates/
// layout.tsx already asks can(actor, "templates.manage") and wraps every
// /templates/* route including this one, so this check could only ever agree
// with it. Leaving it as requireAdmin would have been worse than redundant —
// it would have been the one guard on the templates surface that ignores the
// override layer, and the /templates page would keep rendering for a user the
// layout had already decided to bounce. Deleted rather than converted: one
// guard, in the layout, is the whole point of putting it there.
export default function TemplatesPage() {
  return <TemplatesClient />
}
