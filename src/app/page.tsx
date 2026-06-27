import Link from "next/link"
import Image from "next/image"
import { FileText, BarChart2, ArrowRight, Store, Clock } from "lucide-react"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8"><Image src="/logo.png" alt="Froot" width={32} height={32} /></div>
          <span className="font-semibold text-[var(--color-foreground)]">froot</span>
        </div>
        <Link
          href="/sign-in"
          className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-5 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Sign In
        </Link>
      </header>

      {/* Hero */}
      <section className="text-center px-8 py-20 max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold text-[var(--color-foreground)] leading-tight mb-6">
          Run the work. Prove it<br />happened. Fix what didn&apos;t.
        </h1>
        <p className="text-lg text-[var(--color-muted-foreground)] mb-8 max-w-2xl mx-auto">
          Froot is the execution layer for multi-store operations — checklists,
          training, and audit-ready accountability in one place.
        </p>
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-8 py-3 rounded-md text-base font-medium hover:opacity-90 transition-opacity"
        >
          Get Started <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
          F.R.O.O.T. — Framework for Routine Operations &amp; Organizational Tasks
        </p>
      </section>

      {/* Stack comparison */}
      <section className="px-8 py-12 bg-[var(--color-card)] border-y border-[var(--color-border)]">
        <h2 className="text-2xl font-bold text-center text-[var(--color-foreground)] mb-10">
          Designed to Fit Into Your Existing Stack
        </h2>
        <div className="max-w-3xl mx-auto grid grid-cols-2 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded bg-[var(--color-muted)] flex items-center justify-center text-sm">👥</div>
              <h3 className="font-semibold text-[var(--color-foreground)]">Your Workforce System</h3>
            </div>
            <ul className="space-y-1.5 text-sm text-[var(--color-muted-foreground)]">
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)]">»</span> Team members</li>
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)]">»</span> Locations</li>
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)]">»</span> Schedules</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7"><Image src="/logo.png" alt="Froot" width={28} height={28} /></div>
              <h3 className="font-semibold text-[var(--color-foreground)]">Froot</h3>
            </div>
            <ul className="space-y-1.5 text-sm text-[var(--color-muted-foreground)]">
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)] font-bold">+</span> What needs to be done</li>
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)] font-bold">+</span> How it should be done</li>
              <li className="flex items-center gap-2"><span className="text-[var(--color-primary)] font-bold">+</span> Proof it was done</li>
            </ul>
          </div>
        </div>
        <p className="text-center text-sm text-[var(--color-muted-foreground)] mt-8">
          Froot assumes staffing and scheduling data already exists elsewhere. We focus on execution and accountability.
        </p>
      </section>

      {/* Features */}
      <section className="px-8 py-16">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { icon: Store, title: "Multi-Store Execution", desc: "Run daily operations across all locations with consistent standards and real-time visibility." },
            { icon: Clock, title: "Real-Time Accountability", desc: "Track who did what, when, with photo proof and temperature logs for every critical task." },
            { icon: FileText, title: "Operational Templates", desc: "Define how work should be done with templates for opening, closing, cleaning, and audits." },
            { icon: BarChart2, title: "Audit-Ready Reporting", desc: "Compliance reports, completion trends, and operational insights ready for review anytime." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
              <div className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
              <h3 className="font-semibold text-[var(--color-foreground)] mb-2 text-sm">{title}</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
