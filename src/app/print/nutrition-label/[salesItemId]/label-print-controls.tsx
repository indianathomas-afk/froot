"use client"

import { useEffect } from "react"

// Opens the print dialog on load (print-page convention) and hides itself
// when printing. Mirrors src/app/print/template/[id]/print-controls.tsx.
export function LabelPrintControls({ itemName }: { itemName: string }) {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      <style>{`@media print { .print-toolbar { display: none !important; } }`}</style>
      <div
        className="print-toolbar"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, padding: "10px 0", borderBottom: "1px solid #e0e0e0" }}
      >
        <span style={{ fontSize: 13, color: "#666" }}>{itemName}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => window.print()}
            style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid #e53e1a", background: "#e53e1a", color: "white", fontWeight: 600 }}
          >
            Print / Save as PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid #ddd", background: "white", color: "#333" }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
