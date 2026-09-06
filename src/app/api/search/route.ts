import { NextRequest, NextResponse } from "next/server"
import { requireHrTrainingReadAccess } from "@/app/api/hr/training/access"
import { appHelpScope } from "@/lib/help-server"
import { searchAll, type TrainingSearchAccess } from "@/lib/search"

// SEARCH-1 — the global search bar's route. Thin: resolve the two sources'
// access, call searchAll, return groups.
//
// THE ROLE QUESTION IS ASKED BY CALLING THE PAGE'S OWN GUARD, NOT BY RETYPING
// IT (Gary, 2026-09-06). requireHrTrainingReadAccess() is the same function
// behind GET /api/hr/training/library and the two read pages, and it asks the
// raw role string /hr/training asks at page.tsx:48. Transcribing that string
// here would be DEBT-85 made worse — a second copy free to drift from the page
// it is supposed to agree with.
//
// IT ALSO CARRIES BOTH MODULE GATES, which is why there is no separate check
// for them: the guard runs hrModuleAvailable(clerkOrgId) and then
// requireModule("hr"), so an environment without HR and an org with the module
// toggled off both come back refused and the training group is empty. One call
// answers availability, the org toggle and the role.
//
// A REFUSAL IS AN EMPTY GROUP, NEVER A STATUS CODE. The guard's `response` is
// deliberately discarded: search is not the training API, and a reader outside
// the training read tier should get help results with no training group, not a
// 403 for the whole search. Nothing about the refusal reaches the client.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? ""

  try {
    const [training, helpScope] = await Promise.all([trainingAccess(), appHelpScope()])
    const groups = await searchAll(training, helpScope, query)
    return NextResponse.json({ groups }, headers())
  } catch {
    // Unauthenticated, no org, or a misconfigured environment — empty groups,
    // not an error. There is nothing here to leak and nothing worth a stack
    // trace. This is the path a broken environment takes, and it must carry the
    // cache header exactly like the successful ones.
    return NextResponse.json({ groups: [] }, headers())
  }
}

/** The training gate, reduced to what searchAll needs, or null when refused. */
async function trainingAccess(): Promise<TrainingSearchAccess> {
  const access = await requireHrTrainingReadAccess()
  if (!access.ok) return null
  return { orgDbId: access.org.id, role: access.role, storeIds: access.storeIds }
}

// EVERY RETURN PATH CARRIES THIS, including the catch — the defect
// scripts/verify-help-routes.ts found on /api/help/search's two quiet paths on
// 2026-09-05 and the reason that script exists. An empty result set is not a
// disclosure, but an empty one heuristically cached under this URL and served
// to a reader entitled to a full one is silent breakage with nothing in any
// log. `private` is load-bearing: these results are per-reader by construction.
function headers() {
  return { status: 200, headers: { "Cache-Control": "private, no-store" } }
}
