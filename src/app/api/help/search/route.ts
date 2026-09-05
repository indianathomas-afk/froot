import { NextRequest, NextResponse } from "next/server"
import { getActiveStaffSelf } from "@/lib/auth"
import { appHelpScope, myHelpScope } from "@/lib/help-server"
import { searchIndex } from "@/lib/help-access"

// HELP-1a — the help search index. PER-REQUEST, and it cannot be anything else.
//
// labor.access is one of 26 capabilities that can be DENIED PER USER, so two
// MANAGERs in the same org with the same role and the same modules can have
// different visible article sets. A static index with four role variants cannot
// represent that — the worst-case variant count is 4 × 2^26 — and a client-side
// index containing every article is readable in devtools no matter what the UI
// filters, which would make the filtering decoration (audit §F.2, ruling 3).
//
// NO SEARCH LIBRARY. The audit measured the full 44-row ADMIN index at 5.5 KB
// gzipped; a substring filter over title + summary + keywords is O(44) per
// keystroke. MiniSearch and FlexSearch are built for thousands of documents and
// at this scale the index-building cost exceeds the search cost. This route
// returns the reader's whole index and the client filters it.
//
// TITLES, SUMMARIES AND KEYWORDS ONLY — never bodies. That is not a size
// decision, it is the confidentiality boundary: a summary is written to be safe
// in a search result and a body is not. Bodies are fetched per article through
// the same check.
export async function GET(request: NextRequest) {
  const surface = request.nextUrl.searchParams.get("surface") === "my" ? "my" : "app"

  try {
    if (surface === "my") {
      const self = await getActiveStaffSelf()
      if (!self.ok) return NextResponse.json({ rows: [] }, { status: 200 })
      const scope = myHelpScope(self.dbUser, self.org)
      return NextResponse.json({ rows: searchIndex(scope) }, headers())
    }
    const scope = await appHelpScope()
    return NextResponse.json({ rows: searchIndex(scope) }, headers())
  } catch {
    // Unauthenticated or no org — an empty index, not an error. There is
    // nothing here to leak and nothing worth a stack trace.
    return NextResponse.json({ rows: [] }, { status: 200 })
  }
}

// The index is per-reader, so it must never reach a shared cache. `private` is
// load-bearing rather than decorative — the same reasoning as the image route.
function headers() {
  return { status: 200, headers: { "Cache-Control": "private, no-store" } }
}
