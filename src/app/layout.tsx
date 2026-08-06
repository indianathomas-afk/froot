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
  appleWebApp: { title: "Froot", capable: false },
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
