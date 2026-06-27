import { SignIn } from "@clerk/nextjs"
import Image from "next/image"

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(97% .02 65)" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-3">
            <Image src="/logo.png" alt="Froot" width={64} height={64} />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">froot</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Framework for Routine Operations &<br />Organizational Tasks
          </p>
        </div>
        <SignIn
          forceRedirectUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm p-6",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
              socialButtonsBlockButton: "border border-[var(--color-border)] hover:bg-[var(--color-accent)]",
              formButtonPrimary: "bg-[var(--color-primary)] hover:opacity-90",
              footerActionLink: "text-[var(--color-primary)]",
            },
          }}
        />
      </div>
    </div>
  )
}
