import { DV_FOOTNOTE, LABEL_MICRO_ROWS, LABEL_ROWS, type LabelValue, type NutritionLabel } from "@/lib/nutrition-label"

// The FDA-format Nutrition Facts panel (N-2), rendered from a label built by
// src/lib/nutrition-label.ts. Presentation only — every number arrives already
// rounded. No hooks, so the preview (client) and the print page (server) both
// render it. Always black on white: it is a facsimile of a printed panel, not
// app chrome. Order and names: 101.9(c), (c)(8)(ii); dual columns separated by
// vertical lines: 101.9(e)(6).

const Rule = ({ weight }: { weight: "thin" | "mid" | "thick" }) => (
  <div className={weight === "thick" ? "h-[10px] bg-black" : weight === "mid" ? "h-[5px] bg-black" : "h-px bg-black"} />
)

function amountText(row: { key: string; label: string }, v: LabelValue) {
  // (c)(6)(iii): "Includes X g Added Sugars".
  if (row.key === "addedSugarsG") return <>Includes {v.text} Added Sugars</>
  return v.text
}

function Dv({ v }: { v: LabelValue }) {
  // A missing amount already reads "—"; it has no %DV to show.
  if (v.missing || v.dv === null) return null
  return <span className="font-bold">{v.dv}%</span>
}

export function NutritionFactsLabel({ label }: { label: NutritionLabel }) {
  const cols = label.columns
  const dual = label.dual
  return (
    <div className="bg-white text-black border border-black p-1.5 font-sans w-full max-w-[22rem] leading-tight" data-nutrition-label>
      <div className="text-[2rem] font-black leading-none tracking-tight">Nutrition Facts</div>
      <Rule weight="thin" />
      <div className="text-sm py-0.5">{label.servingsPerContainer}</div>
      <div className="flex justify-between font-bold text-base">
        <span>Serving size</span>
        <span>{label.servingSize}</span>
      </div>
      <Rule weight="thick" />

      {dual && (
        <div className="grid grid-cols-[1fr_auto_auto] text-xs font-bold">
          <span />
          {cols.map((c) => (
            <span key={c.heading} className="w-24 text-right border-l border-black pl-1">{c.heading}</span>
          ))}
        </div>
      )}
      {!dual && <div className="text-xs font-bold pt-0.5">{cols[0].heading}</div>}

      <div className={dual ? "grid grid-cols-[1fr_auto_auto] items-end" : "flex justify-between items-end"}>
        <span className="text-2xl font-black">Calories</span>
        {cols.map((c) => (
          <span key={c.heading} className={`text-3xl font-black text-right ${dual ? "w-24 border-l border-black pl-1" : ""}`}>
            {c.values.calories.text}
          </span>
        ))}
      </div>
      <Rule weight="mid" />

      <div className={`text-xs font-bold text-right py-0.5 ${dual ? "grid grid-cols-[1fr_auto_auto]" : ""}`}>
        {dual ? (
          <>
            <span />
            {cols.map((c) => <span key={c.heading} className="w-24 border-l border-black pl-1">% Daily Value*</span>)}
          </>
        ) : (
          "% Daily Value*"
        )}
      </div>

      {LABEL_ROWS.map((row) => (
        <div key={row.key} className={`border-t border-black text-sm py-0.5 ${dual ? "grid grid-cols-[1fr_auto_auto]" : "flex justify-between"}`}>
          {dual ? (
            <>
              <span className={row.indent === 1 ? "pl-4" : row.indent === 2 ? "pl-8" : ""}>
                <span className={row.bold ? "font-bold" : ""}>{row.key === "addedSugarsG" ? "Added Sugars" : row.label}</span>
              </span>
              {cols.map((c) => (
                <span key={c.heading} className="w-24 border-l border-black pl-1 flex justify-between gap-1">
                  <span>{c.values[row.key].text}</span>
                  <Dv v={c.values[row.key]} />
                </span>
              ))}
            </>
          ) : (
            <>
              <span className={row.indent === 1 ? "pl-4" : row.indent === 2 ? "pl-8" : ""}>
                {row.key === "addedSugarsG" ? (
                  amountText(row, cols[0].values[row.key])
                ) : (
                  <>
                    <span className={row.bold ? "font-bold" : ""}>{row.label}</span> {cols[0].values[row.key].text}
                  </>
                )}
              </span>
              <Dv v={cols[0].values[row.key]} />
            </>
          )}
        </div>
      ))}
      <Rule weight="thick" />

      {LABEL_MICRO_ROWS.map((row, i) => (
        <div
          key={row.key}
          className={`text-sm py-0.5 ${i > 0 ? "border-t border-black" : ""} ${dual ? "grid grid-cols-[1fr_auto_auto]" : "flex justify-between"}`}
        >
          {dual ? (
            <>
              <span>{row.label}</span>
              {cols.map((c) => (
                <span key={c.heading} className="w-24 border-l border-black pl-1 flex justify-between gap-1">
                  <span>{c.values[row.key].text}</span>
                  <Dv v={c.values[row.key]} />
                </span>
              ))}
            </>
          ) : (
            <>
              <span>
                {row.label} {cols[0].values[row.key].text}
              </span>
              <Dv v={cols[0].values[row.key]} />
            </>
          )}
        </div>
      ))}
      <Rule weight="mid" />
      <p className="text-[0.65rem] py-1 flex gap-1">
        <span>*</span>
        <span>{DV_FOOTNOTE}</span>
      </p>
      {label.contains && <p className="border-t border-black text-xs font-bold pt-1">{label.contains}</p>}
    </div>
  )
}
