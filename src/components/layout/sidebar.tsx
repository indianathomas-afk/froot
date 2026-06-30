"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
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
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useClerk, useUser } from "@clerk/nextjs"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/checklists", label: "Checklists", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/templates", label: "Templates", icon: FileText, roles: ["ADMIN", "MANAGER"] },
  { href: "/stores", label: "Stores", icon: Store, roles: ["ADMIN", "MANAGER"] },
  { href: "/users", label: "Users", icon: Users, roles: ["ADMIN"] },
  { href: "/staff", label: "Staff", icon: UserSquare, roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: BarChart2, roles: ["ADMIN", "MANAGER"] },
  { href: "/store-view", label: "Store View", icon: Eye, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
]

const STORAGE_KEY = "froot-sidebar-collapsed"

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const visibleNavItems = navItems.filter((item) => item.roles.includes(role))
  const canSeeSettings = role === "ADMIN"

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "true") setCollapsed(true)
    setMounted(true)
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev))
      return !prev
    })
  }

  const w = collapsed ? "w-[60px]" : "w-[190px]"

  if (!mounted) return <aside className="fixed left-0 top-0 h-screen w-[190px] bg-[var(--color-card)] border-r border-[var(--color-border)] z-40" />

  return (
    <aside className={cn("fixed left-0 top-0 h-screen flex flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] z-40 transition-all duration-200", w)}>
      {/* Logo + toggle */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-[var(--color-border)]">
        <div className="w-8 h-8 shrink-0">
          <Image src="/logo.png" alt="Froot" width={32} height={32} />
        </div>
        {!collapsed && <span className="flex-1" />}
        <button
          onClick={toggle}
          className="p-1 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] transition-colors shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {visibleNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2" : "",
                isActive
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Settings */}
      {canSeeSettings && (
        <div className="px-2 py-2">
          <Link
            href="/settings"
            title={collapsed ? "Settings" : undefined}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
              collapsed ? "justify-center px-2" : "",
              pathname.startsWith("/settings")
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            <Settings className={cn("h-4 w-4 shrink-0", pathname.startsWith("/settings") ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
            {!collapsed && "Settings"}
          </Link>
        </div>
      )}

      {/* User info */}
      <div className="border-t border-[var(--color-border)] px-3 py-3">
        {collapsed ? (
          <button
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
            title="Sign out"
            className="flex items-center justify-center w-full text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-xs font-semibold text-[var(--color-muted-foreground)] shrink-0">
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
          </>
        )}
      </div>
    </aside>
  )
}
