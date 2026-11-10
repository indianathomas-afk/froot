import type { Metadata } from "next"
import { ClerkProvider } from "@clerk/nextjs"
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
