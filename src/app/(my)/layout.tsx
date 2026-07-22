// HR-7 staff self-service shell: a lightweight, mobile-first wrapper — no
// admin sidebar, no AppShell. Every page under /my/* guards itself with
// getActiveStaffSelf(); this layout is presentation only.
export default function MyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[var(--color-background)]">{children}</div>
}
