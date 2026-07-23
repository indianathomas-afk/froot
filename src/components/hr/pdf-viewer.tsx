"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"

// HR-11 shared inline PDF viewer: renders every page of an authed, private
// document to canvases, lazily as pages approach the viewport. No copies are
// made — bytes come straight from the existing authed HR routes (same-origin
// cookies ride along) and live only in the canvas. pdf.js is dynamically
// imported so its ~1MB core only loads on routes that render documents.
//
// Page visibility is reported via onPageViewed (>=40% of the page on screen),
// which the signing screen uses for its "reviewed each page" progression.

type PdfJs = typeof import("pdfjs-dist")
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>

export function PdfViewer({
  src,
  onReady,
  onPageViewed,
  onError,
  pageOverlay,
}: {
  src: string
  /** Called once with the page count when the document opens. */
  onReady?: (pageCount: number) => void
  /** Called the first time each 1-based page number is substantially visible. */
  onPageViewed?: (pageNumber: number) => void
  /** Called when the document cannot be opened/rendered inline. */
  onError?: (err: unknown) => void
  /** Rendered inside each page wrapper (absolute-position friendly). */
  pageOverlay?: (pageNumber: number) => ReactNode
}) {
  const [pageCount, setPageCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const docRef = useRef<PdfDocument | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Refs so the latest callbacks are used without re-opening the document.
  const onReadyRef = useRef(onReady)
  const onPageViewedRef = useRef(onPageViewed)
  const onErrorRef = useRef(onError)
  onReadyRef.current = onReady
  onPageViewedRef.current = onPageViewed
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<PdfJs["getDocument"]> | null = null
    ;(async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString()
        task = pdfjs.getDocument({ url: src })
        const doc = await task.promise
        if (cancelled) return
        docRef.current = doc
        setPageCount(doc.numPages)
        onReadyRef.current?.(doc.numPages)
      } catch (err) {
        if (cancelled) return
        console.error("[hr-pdf-viewer] failed to open document:", err)
        setFailed(true)
        onErrorRef.current?.(err)
      }
    })()
    return () => {
      cancelled = true
      docRef.current = null
      task?.destroy().catch(() => {})
    }
  }, [src])

  if (failed) return null

  return (
    <div ref={containerRef} className="space-y-3">
      {pageCount === 0 ? (
        <>
          <Skeleton className="w-full aspect-[8.5/11] rounded-lg" />
          <Skeleton className="w-full aspect-[8.5/11] rounded-lg" />
        </>
      ) : (
        Array.from({ length: pageCount }, (_, i) => (
          <PdfPage
            key={i + 1}
            pageNumber={i + 1}
            getDoc={() => docRef.current}
            onViewed={() => onPageViewedRef.current?.(i + 1)}
            overlay={pageOverlay?.(i + 1)}
          />
        ))
      )}
    </div>
  )
}

function PdfPage({
  pageNumber,
  getDoc,
  onViewed,
  overlay,
}: {
  pageNumber: number
  getDoc: () => PdfDocument | null
  onViewed: () => void
  overlay?: ReactNode
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderedRef = useRef(false)
  const viewedRef = useRef(false)
  const [rendered, setRendered] = useState(false)

  const render = useCallback(async () => {
    if (renderedRef.current) return
    const doc = getDoc()
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!doc || !wrapper || !canvas) return
    renderedRef.current = true
    try {
      const page = await doc.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const width = wrapper.clientWidth || baseViewport.width
      const scale = width / baseViewport.width
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * dpr })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      setRendered(true)
    } catch (err) {
      renderedRef.current = false
      console.error(`[hr-pdf-viewer] render failed page=${pageNumber}:`, err)
    }
  }, [getDoc, pageNumber])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    // Two observers, two jobs: start rendering well before the page scrolls
    // in; count it as VIEWED only when a substantial part is actually seen.
    const renderObserver = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && render()),
      { rootMargin: "600px 0px" }
    )
    const viewObserver = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting && !viewedRef.current) {
            viewedRef.current = true
            onViewed()
          }
        }),
      { threshold: 0.4 }
    )
    renderObserver.observe(el)
    viewObserver.observe(el)
    return () => {
      renderObserver.disconnect()
      viewObserver.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render])

  return (
    <div ref={wrapperRef} className="relative">
      <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden shadow-sm">
        {!rendered && <Skeleton className="w-full aspect-[8.5/11]" />}
        <canvas ref={canvasRef} className={rendered ? "block w-full" : "hidden"} />
      </div>
      {overlay}
    </div>
  )
}
