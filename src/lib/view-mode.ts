// TAB-1 — the Tablet/Desktop switch (Gary's ruling 2, 2026-11-09).
//
// SAVED PER DEVICE, DEFAULTS TO DESKTOP, NEVER SWITCHES ON ITS OWN. Stored in a
// cookie rather than localStorage so the server reads it in the (app) layout and
// renders the right shell on first paint — no desktop flash before the tablet
// shell mounts. It is still per device: a cookie lives in this browser only.
//
// Nothing in this file inspects the user agent or the viewport. Only the switch
// writes the cookie, and only a tap on the switch calls it.
//
// PWA-1 (2026-11-11, DRAFT ruling R1 amending ruling 2 above): ONE exception.
// Launched from the home-screen icon (display-mode standalone) with NO choice
// saved on this device, Froot opens in Tablet — written once by
// src/components/layout/standalone-tablet-default.tsx. A saved choice always
// wins, and Safari / desktop browsers still default Desktop and never switch.
// Still no user-agent or viewport sniffing.
//
// Pure constants + parsers, so client and server components can both import
// it (plus writeViewCookie, which touches `document` and is client-only). The server read lives in view-mode-server.ts (next/headers is server-only).

export const VIEW_COOKIE = "froot_view"
export type ViewMode = "tablet" | "desktop"

/** One year, in seconds — the cookie's max-age. */
export const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Client-only: save this device's view. The switch and the PWA-1 home-screen
 *  default both write through here, so the cookie has one shape. */
export function writeViewCookie(mode: ViewMode) {
  document.cookie = `${VIEW_COOKIE}=${mode}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; samesite=lax`
}

/** PWA-1 — a choice is saved only when the cookie holds one of the two modes.
 *  Absent, blank or junk counts as "nothing saved". */
export function isSavedViewMode(value: string | undefined | null): boolean {
  return value === "tablet" || value === "desktop"
}

/** Anything but the literal "tablet" is desktop — absent, blank or junk. */
export function parseViewMode(value: string | undefined | null): ViewMode {
  return value === "tablet" ? "tablet" : "desktop"
}
