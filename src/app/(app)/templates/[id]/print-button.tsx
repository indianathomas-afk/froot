"use client"

export function PrintButton({ templateId }: { templateId: string }) {
  return (
    <button
      onClick={() => window.open(`/print/template/${templateId}`, "_blank")}
      className="text-sm bg-[var(--color-primary)] text-white rounded px-3 py-1.5 hover:opacity-90 transition-opacity"
    >
      Print / Save PDF
    </button>
  )
}
