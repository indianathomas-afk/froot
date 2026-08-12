"use client"

import { useEffect, useRef } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Italic, List, ListOrdered } from "lucide-react"
import { isEmptyRichText, looksLikeHtml, plainTextToHtml } from "@/lib/rich-text"
import { cn } from "@/lib/utils"

// HR-28: the WYSIWYG editor behind a training module's description. Bold,
// italic, bullets and numbers — nothing else, on purpose.
//
// THE TOOLBAR AND THE SANITIZER ARE ONE DECISION, NOT TWO. Every tag this
// editor can produce is on src/lib/sanitize-html.ts's allowlist, and every tag
// on that allowlist is something the toolbar can make. StarterKit ships
// headings, links, code, blockquotes, strikethrough, underline and horizontal
// rules ENABLED BY DEFAULT — left alone, an admin would style a heading with
// Cmd-Alt-1, save, and watch it come back as plain text, because the server
// strips what the allowlist does not name. Formatting that appears to work and
// then silently doesn't is worse than formatting that was never offered, so
// they are turned off at the source below. Adding a button here means adding
// its tag there, in the same commit.
const EXTENSIONS = [
  StarterKit.configure({
    // Off: not on the allowlist (see above).
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
    // Off for a different reason: trailingNode appends a real empty paragraph
    // to the document so there is always somewhere to click below the last
    // block. It serialises, so a description ending in a list would be stored
    // as "<ul>…</ul><p></p>" and render with a stray gap under it.
    trailingNode: false,
  }),
]

// What to hand Tiptap for a value that may predate this editor. Plain text
// keeps its line breaks (plainTextToHtml); HTML goes in as-is.
function toEditorHtml(value: string): string {
  if (!value.trim()) return ""
  return looksLikeHtml(value) ? value : plainTextToHtml(value)
}

interface ToolbarButtonProps {
  onClick: () => void
  active: boolean
  label: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, label, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      // Without this the button steals focus from the editor on press, which
      // collapses the selection — so "select a word, click Bold" would bold
      // nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "p-1.5 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors",
        active && "bg-[var(--color-accent)] text-[var(--color-foreground)]"
      )}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}) {
  // The last HTML this editor emitted. Without it the sync effect below cannot
  // tell "the parent reset the field" from "the parent is echoing back what we
  // just typed", and it would reset the document on every keystroke — cursor
  // to the top of the box, mid-sentence.
  const lastEmitted = useRef<string | null>(null)

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: toEditorHtml(value),
    // Required under Next's SSR: rendering the editor during the server pass
    // produces markup React then disagrees with on hydration.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // [&_li_p]:mb-0 is load-bearing: Tiptap wraps every list item's content
        // in a <p>, so the paragraph spacing above would otherwise apply inside
        // each bullet and space the list out like body copy. Kept identical to
        // the renderer's class list (training-module-view.tsx) so the editor
        // shows what staff will see.
        class:
          "outline-none min-h-[80px] text-sm text-[var(--color-foreground)] [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:mb-0.5 [&_li_p]:mb-0",
      },
    },
    onUpdate: ({ editor }) => {
      // Emit "" rather than Tiptap's "<p></p>" for an emptied box, so an admin
      // who clears the field sends the same nothing the old textarea sent.
      // (The server normalizes "<p></p>" to null too — this just keeps the
      // payload honest about what the admin did.)
      const html = editor.isEmpty ? "" : editor.getHTML()
      lastEmitted.current = html
      onChange(html)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value === lastEmitted.current) return

    const next = toEditorHtml(value)
    if (next === editor.getHTML()) return

    editor.commands.setContent(next, { emitUpdate: false })
    lastEmitted.current = value
  }, [value, editor])

  const { bold, italic, bulletList, orderedList } = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
    }),
  }) ?? { bold: false, italic: false, bulletList: false, orderedList: false }

  // Derived from the VALUE, not from editor state, so it is right on the first
  // paint — before the editor has mounted there is no editor to ask.
  const showPlaceholder = !value.trim() || isEmptyRichText(value)

  return (
    // Matches Input/Textarea: same border token, same radius, same shadow, and
    // the focus ring moves to focus-within because the focusable element is the
    // contenteditable inside, not this box.
    <div
      className={cn(
        "w-full rounded-md border border-[var(--color-input)] bg-transparent shadow-sm focus-within:outline-none focus-within:ring-1 focus-within:ring-[var(--color-ring)]",
        className
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-[var(--color-border)] px-1.5 py-1">
        <ToolbarButton
          label="Bold"
          active={bold}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={italic}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={bulletList}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={orderedList}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
      </div>

      <div className="relative px-3 py-2">
        {showPlaceholder && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-[var(--color-muted-foreground)]">
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
