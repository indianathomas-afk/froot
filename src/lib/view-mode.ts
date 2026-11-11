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
// Pure constants + a parser, so client and server components can both import
// it. The server read lives in view-mode-server.ts (next/headers is server-only).

export const VIEW_COOKIE = "froot_view"
export type ViewMode = "tablet" | "desktop"

/** One year, in seconds — the cookie's max-age. */
export const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Anything but the literal "tablet" is desktop — absent, blank or junk. */
export function parseViewMode(value: string | undefined | null): ViewMode {
  return value === "tablet" ? "tablet" : "desktop"
}
