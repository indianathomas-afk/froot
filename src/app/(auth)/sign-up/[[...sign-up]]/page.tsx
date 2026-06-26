import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(97% .02 65)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-[var(--color-primary)] flex items-center justify-center mx-auto mb-3 text-3xl">
            🍊
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">froot</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Framework for Routine Operations &<br />Organizational Tasks
          </p>
        </div>
        <SignUp
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm p-6",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              formButtonPrimary: "bg-[var(--color-primary)] hover:opacity-90",
              footerActionLink: "text-[var(--color-primary)]",
            },
          }}
        />
      </div>
    </div>
  )
}
