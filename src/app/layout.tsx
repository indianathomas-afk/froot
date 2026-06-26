import type { Metadata } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import "./globals.css"

export const metadata: Metadata = {
  title: "Froot — Framework for Routine Operations & Organizational Tasks",
  description: "Operational execution and accountability platform for multi-store franchises",
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
