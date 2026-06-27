"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CheckSquare,
  FileText,
  Store,
  Users,
  UserSquare,
  BarChart2,
  Eye,
  Settings,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useClerk, useUser } from "@clerk/nextjs"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/checklists", label: "Checklists", icon: CheckSquare },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/users", label: "Users", icon: Users },
  { href: "/staff", label: "Staff", icon: UserSquare },
  { href: "/reports", label: "Reports", icon: BarChart2 },
  { href: "/store-view", label: "Store View", icon: Eye },
]

export function Sidebar() {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()

  return (
    <aside className="fixed left-0 top-0 h-screen w-[190px] flex flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] z-40">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-[var(--color-border)]">
        <div className="w-8 h-8">
          <Image src="/logo.png" alt="Froot" width={32} height={32} />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Settings */}
      <div className="px-2 py-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
              : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
          )}
        >
          <Settings className={cn("h-4 w-4 shrink-0", pathname.startsWith("/settings") ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
          Settings
        </Link>
      </div>

      {/* User info */}
      <div className="border-t border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-xs font-semibold text-[var(--color-muted-foreground)]">
            {user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0]}</p>
            <p className="text-xs text-[var(--color-muted-foreground)] truncate">{user?.emailAddresses?.[0]?.emailAddress}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
