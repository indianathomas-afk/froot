"use client"

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-sm bg-[var(--color-primary)] text-white rounded px-3 py-1.5 hover:opacity-90 transition-opacity print:hidden"
    >
      Print
    </button>
  )
}
