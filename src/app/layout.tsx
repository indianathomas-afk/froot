import type { Metadata, Viewport } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import { FROOT_CREAM } from "@/lib/froot-cream"
import "./globals.css"

export const metadata: Metadata = {
  title: "Froot — Framework for Routine Operations & Organizational Tasks",
  description: "Operational execution and accountability platform for multi-store franchises",
  // Home-screen label on the store iPads. Without a title here iOS uses the
  // <title> above and shows "Froot — Fram…".
  //
  // `capable` MUST stay explicit. Next resolves a missing key to TRUE
  // (node_modules/next/dist/esm/lib/metadata/resolvers/resolve-basics.js:147),
  // so `appleWebApp: { title }` alone would emit mobile-web-app-capable and
  // silently launch the iPads in standalone mode. The standalone decision
  // belongs to src/app/manifest.ts, not to a default.
  //
  // TAB-1 (2026-11-09) — `capable` is now an explicit TRUE, matching the
  // manifest's display:"standalone" (28bbd8a) rather than defaulting into it.
  // Tablet mode is built for "Add to Home Screen" on the counter iPad opening
  // Froot full screen, and older iOS reads this meta tag, not the manifest.
  // Still explicit, so the comment above keeps its force: flip it here, on
  // purpose, or not at all. A home-screen launch keeps its own cookie jar, so
  // the crew signs in once and picks Tablet again inside the home-screen app.
  appleWebApp: { title: "Froot", capable: true, statusBarStyle: "default" },
  // PWA-1 (2026-11-11) — the premise above that this meta tag reaches older iOS
  // was not true of this Next. 16.2.9 renders `capable` as the UNPREFIXED
  // `mobile-web-app-capable` only (node_modules/next/dist/esm/lib/metadata/
  // metadata.js:587), so `apple-mobile-web-app-capable` — the name older iOS
  // reads — was never in the head. Emitted explicitly here, alongside the
  // unprefixed one; both say the same thing as manifest.ts display:"standalone".
  other: { "apple-mobile-web-app-capable": "yes" },
}

// PWA-1 (2026-11-11) — the browser/status-bar tint, the same cream as the
// manifest. viewportFit is deliberately NOT "cover": with statusBarStyle
// "default" iOS keeps the status bar as dark text on light and keeps content out
// of the status-bar and home-indicator areas itself, so no safe-area padding is
// needed. ("black-translucent" would draw white status text over a cream app.)
export const viewport: Viewport = {
  themeColor: FROOT_CREAM,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className="min-h-full antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
