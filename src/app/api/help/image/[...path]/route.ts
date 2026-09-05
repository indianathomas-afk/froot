import { NextRequest, NextResponse } from "next/server"
import { getActiveStaffSelf } from "@/lib/auth"
import { appHelpScope, myHelpScope } from "@/lib/help-server"
import { streamGuideImage } from "@/lib/guide-files"

// HELP-1a — guide image delivery. Ruling 7.
//
// BEING SIGNED IN IS NOT SUFFICIENT, and this is the whole reason the route
// exists rather than a public path. A section hidden from a STORE login renders
// nothing in the HTML — but if its screenshot were served to any signed-in
// session, that reader could fetch the PICTURE of the section they were not
// allowed to see. The prose would be absent and the image would say it anyway.
//
// SO THE GATE IS THE NARROWEST ENCLOSING SCOPE: the image's SECTION where it
// sits in one, otherwise its ARTICLE. Gating at the article level would be
// correct for most images and wrong for exactly the ones ruling 6 exists to
// protect — the Ingredients article is visible to STORE, and the screenshot
// inside its restore-deleted section must not be.
//
// canReadImage() is NOT a separate policy. It resolves the image to its scope
// and defers to the same check the section and the article use, in
// src/lib/help-access.ts. One mapping from help resource to governing
// capability; three callers of it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const pathname = path.join("/")
  const surface = request.nextUrl.searchParams.get("surface") === "my" ? "my" : "app"

  try {
    const scope =
      surface === "my"
        ? await (async () => {
            const self = await getActiveStaffSelf()
            return self.ok ? myHelpScope(self.dbUser, self.org) : null
          })()
        : await appHelpScope()

    // 404 FOR BOTH UNKNOWN AND FORBIDDEN, and the difference from HR-3 is
    // deliberate. HR's download route returns 403 for real-but-forbidden
    // because the caller was plausibly shown the id by a stale page. Here the
    // opposite holds: a 403 confirms that the image — and therefore a hidden
    // SECTION — exists. That is the same disclosure the /settings/labor nav
    // ruling refuses, one layer down.
    if (!scope || !scope.canReadImage(pathname)) return notFound()

    const upstream = await streamGuideImage(pathname)
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": "inline",
        // `private` is load-bearing, not decorative. Guide screenshots are
        // re-read often enough that no-store would be wasteful, but a shared or
        // CDN cache would serve a capability-gated image to the wrong reader.
        // Browser-only caching is the correct middle.
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch {
    // An unset token or an upstream failure must not distinguish itself from a
    // refusal either — same 404, no detail.
    return notFound()
  }
}

function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } })
}
