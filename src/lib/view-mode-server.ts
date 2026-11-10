import "server-only"
import { cookies } from "next/headers"
import { VIEW_COOKIE, parseViewMode, type ViewMode } from "./view-mode"

/** TAB-1 — this device's saved view. `desktop` when the cookie is absent. */
export async function getViewMode(): Promise<ViewMode> {
  return parseViewMode((await cookies()).get(VIEW_COOKIE)?.value)
}
