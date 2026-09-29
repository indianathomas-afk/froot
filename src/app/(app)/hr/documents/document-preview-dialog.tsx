"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Download, FileText, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { hrPreviewType } from "@/lib/hr-documents"

// DOC-11: the Document Library's Preview. A LOOK, not a reader: current
// version only (ruling 4), nothing recorded (ruling 5 — the inline route writes
// nothing and this component calls nothing else).
//
// PDFs render through the HR-11 PdfViewer (pdfjs-dist, canvases drawn lazily
// as pages near the viewport, worker bundled same-origin) rather than the
// browser's own viewer in an iframe, which on iPhone Safari shows page 1 only
// (ruling 3). next/dynamic + ssr:false keeps the viewer out of the library's
// main bundle and off the server entirely.
const PdfViewer = dynamic(() => import("@/components/hr/pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <PreviewSpinner />,
})

export type PreviewDocument = {
  id: string
  title: string
  fileName: string
  contentType: string
  versionNumber: number | null
}

export function DocumentPreviewDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: PreviewDocument
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const downloadUrl = `/api/hr/documents/${doc.id}/download`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Full-screen on phones, near full-screen above sm. The header is a
          fixed row and only the body scrolls. */}
      <DialogContent className="flex flex-col gap-0 p-0 max-w-none w-screen h-[100dvh] rounded-none sm:w-[95vw] sm:max-w-6xl sm:h-[92dvh] sm:rounded-lg overflow-hidden">
        {/* Radix remounts content on each open, so the body's state (page
            count, failure) starts fresh every time. */}
        <PreviewBody doc={doc} downloadUrl={downloadUrl} />
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ doc, downloadUrl }: { doc: PreviewDocument; downloadUrl: string }) {
  const preview = hrPreviewType(doc.contentType, doc.fileName)
  const inlineUrl = `/api/hr/documents/${doc.id}/download?disposition=inline`
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  const meta = [
    doc.versionNumber != null ? `Version ${doc.versionNumber}` : null,
    pageCount != null ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <>
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 pr-12 shrink-0">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base truncate">{doc.title}</DialogTitle>
          <DialogDescription className="text-xs mt-1 truncate">{meta || doc.fileName}</DialogDescription>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href={downloadUrl} target="_blank" rel="noopener">
            <Download className="h-4 w-4 mr-1.5" />
            Download
          </a>
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-muted)] p-3 sm:p-6">
        {!preview ? (
          <PreviewMessage message="Preview not available for this file type" downloadUrl={downloadUrl} />
        ) : failed ? (
          <PreviewMessage message="Couldn't load the preview" downloadUrl={downloadUrl} />
        ) : preview.kind === "pdf" ? (
          <div className="mx-auto max-w-4xl">
            <PdfViewer
              src={inlineUrl}
              refitOnResize
              onReady={(n) => setPageCount(n)}
              onError={() => setFailed(true)}
            />
          </div>
        ) : (
          <>
            {!imageLoaded && <PreviewSpinner />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inlineUrl}
              alt={doc.title}
              className={imageLoaded ? "mx-auto block max-w-full h-auto object-contain" : "hidden"}
              onLoad={() => setImageLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        )}
      </div>
    </>
  )
}

function PreviewSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
      <span className="sr-only">Loading preview</span>
    </div>
  )
}

function PreviewMessage({ message, downloadUrl }: { message: string; downloadUrl: string }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 text-center">
      <FileText className="h-10 w-10 text-[var(--color-muted-foreground)]" />
      <p className="text-sm text-[var(--color-foreground)]">{message}</p>
      <Button asChild size="sm">
        <a href={downloadUrl} target="_blank" rel="noopener">
          <Download className="h-4 w-4 mr-1.5" />
          Download
        </a>
      </Button>
    </div>
  )
}
