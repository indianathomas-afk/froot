"use client"

// TEMPORARY diagnostic error boundary for /settings/labor — surfaces the real
// error message + digest so we can see what's throwing in production. REMOVE
// once the labor settings page is fixed.
export default function LaborSettingsError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold text-[var(--color-destructive)] mb-2">Labor settings error (temp diagnostic)</h1>
      <p className="text-sm mb-1">
        <strong>message:</strong> {error?.message || "(no message)"}
      </p>
      <p className="text-sm mb-3">
        <strong>digest:</strong> {error?.digest || "(none)"}
      </p>
      <pre className="text-xs whitespace-pre-wrap bg-[var(--color-muted)] p-3 rounded max-h-[50vh] overflow-auto">
        {error?.stack || "(no stack)"}
      </pre>
    </div>
  )
}
