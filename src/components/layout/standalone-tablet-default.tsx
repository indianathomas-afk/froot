"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { writeViewCookie } from "@/lib/view-mode"

// PWA-1 (2026-11-11) — DRAFT ruling R1, awaiting Gary at PRE-PUSH-CHECK:
// "When Froot is opened from the iPad home screen icon and nothing is saved on
// that device yet, it opens in Tablet mode. Once someone picks Tablet or Desktop
// on that device, their choice always wins. Opening Froot in Safari or on a
// computer stays Desktop by default and never switches on its own."
//
// Mounted by src/app/(app)/layout.tsx ONLY in the desktop branch and ONLY when
// hasSavedViewMode() is false, so a saved choice never reaches this code. If the
// page is running as a home-screen app, it saves "tablet" (making it a saved
// choice like any other — the switch can change it and that sticks) and
// re-renders the layout, which now draws the tablet shell.
//
// Detection is display-mode only, never the user agent or the viewport:
// `(display-mode: standalone)` for the manifest's display:"standalone", and
// navigator.standalone for older iOS, which sets it on a home-screen launch.
//
// The server cannot see display-mode, so the very first home-screen launch on a
// device paints Desktop for one render before the refresh lands. Once per
// device: from then on the cookie is set and the server draws Tablet first.
//
// No state is set here (react-hooks/set-state-in-effect): the effect only
// writes a cookie and asks the router to refresh.
function launchedFromHomeScreen(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function StandaloneTabletDefault() {
  const router = useRouter()
  useEffect(() => {
    if (!launchedFromHomeScreen()) return
    writeViewCookie("tablet")
    router.refresh()
  }, [router])
  return null
}
