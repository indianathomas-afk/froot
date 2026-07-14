"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { SignOutButton } from "@clerk/nextjs"
import { FileText, GraduationCap, Home } from "lucide-react"

// HR-7 staff portal chrome: slim header + fixed bottom tab bar (mobile-first,
// ≥44px targets, store-view spirit — never the admin sidebar).
const NAV = [
  { href: "/my", label: "Home", icon: Home, exact: true },
  { href: "/my/training", label: "Training", icon: GraduationCap, exact: false },
  { href: "/my/documents", label: "Documents", icon: FileText, exact: false },
]

export function MyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="max-w-lg mx-auto min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/my" className="flex items-center gap-2 min-h-11">
          <div className="w-8 h-8">
            <Image src="/logo.png" alt="Froot" width={32} height={32} />
          </div>
          <span className="font-semibold text-[var(--color-foreground)]">froot</span>
        </Link>
        <SignOutButton redirectUrl="/sign-in">
          <button className="min-h-11 px-4 rounded-md text-sm text-[var(--color-muted-foreground)]">
            Sign out
          </button>
        </SignOutButton>
      </header>

      <main className="flex-1 px-4 pb-24">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="max-w-lg mx-auto flex">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs font-medium ${
                  active
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-muted-foreground)]"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
