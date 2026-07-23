"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchCard } from "@/app/(app)/dashboard/card-fetch"

// STAFF-1 /my home Instagram strip — same contract as the dashboard strip:
// cached feed API, BUG-1 fetch discipline (12s cap, logged failures), and the
// whole card disappears rather than rendering an empty placeholder when the
// feed is unavailable. Tiles link to the post; the header links to the full
// /my/instagram grid.
type InstagramPost = {
  id: string
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_url?: string
  permalink: string
  thumbnail_url?: string
  caption?: string
}

type InstagramFeed = {
  connected: boolean
  enabled: boolean
  username: string | null
  profileUrl: string | null
  posts: InstagramPost[]
}

export function MyInstagramStrip() {
  const [feed, setFeed] = useState<InstagramFeed | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchCard<InstagramFeed>("my instagram strip", "/api/instagram/feed?limit=12").then((data) => {
      if (cancelled) return
      setFeed(data)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (loaded && (!feed || !feed.connected || !feed.enabled || feed.posts.length === 0)) return null

  const posts = feed?.posts ?? []

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
      <Link href="/my/instagram" className="flex items-center justify-between min-h-11 -my-1.5">
        <span className="inline-flex items-center gap-2 font-medium text-[var(--color-foreground)]">
          <InstagramIcon className="h-4 w-4 text-[var(--color-primary)]" />
          Instagram
          {feed?.username && (
            <span className="text-xs text-[var(--color-muted-foreground)]">@{feed.username}</span>
          )}
        </span>
        <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
      </Link>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {!loaded
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="w-20 h-20 rounded-lg shrink-0" />
            ))
          : posts.map((p) => {
              const src = p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url
              return (
                <a
                  key={p.id}
                  href={p.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-20 h-20 rounded-lg overflow-hidden bg-[var(--color-muted)] shrink-0"
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={p.caption ?? "Instagram post"} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-[var(--color-muted-foreground)]">
                      <InstagramIcon className="h-6 w-6" />
                    </span>
                  )}
                </a>
              )
            })}
      </div>
    </div>
  )
}
