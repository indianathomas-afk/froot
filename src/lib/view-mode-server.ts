import "server-only"
import { cookies } from "next/headers"
import { VIEW_COOKIE, isSavedViewMode, parseViewMode, type ViewMode } from "./view-mode"

/** TAB-1 — this device's saved view. `desktop` when the cookie is absent. */
export async function getViewMode(): Promise<ViewMode> {
  return parseViewMode((await cookies()).get(VIEW_COOKIE)?.value)
}

/** PWA-1 — has this device saved a choice at all? `getViewMode()` folds
 *  "absent" into desktop, which is right for rendering; this is the one
 *  question that needs them apart (the home-screen Tablet default). */
export async function hasSavedViewMode(): Promise<boolean> {
  return isSavedViewMode((await cookies()).get(VIEW_COOKIE)?.value)
}
