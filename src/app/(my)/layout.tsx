// HR-7 staff self-service shell: a lightweight, mobile-first wrapper — no
// admin sidebar, no AppShell. Every page under /my/* guards itself with
// getActiveStaffSelf(); this layout is presentation only.
import { UsageBeacon } from "@/components/usage-beacon"

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {children}
      {/* ENG-1 (Gary, D3). The portal's own beacon — STAFF users are redirected
          here out of the admin shell, so without this mount their usage would
          never be counted and the engagement page would call them dormant. */}
      <UsageBeacon />
    </div>
  )
}
