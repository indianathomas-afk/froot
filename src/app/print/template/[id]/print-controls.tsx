"use client"

export function PrintControls() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 24 }}>
      <button
        onClick={() => window.close()}
        style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid #ddd", background: "white", color: "#333" }}
      >
        ✕ Close
      </button>
      <button
        onClick={() => window.print()}
        style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid #e53e1a", background: "#e53e1a", color: "white", fontWeight: 600 }}
      >
        🖨 Print / Save as PDF
      </button>
    </div>
  )
}
