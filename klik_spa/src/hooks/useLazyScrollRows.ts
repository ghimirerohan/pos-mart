import { useEffect, useRef, useState } from "react"

const DEFAULT_INITIAL = 20
const DEFAULT_BATCH = 20

/**
 * Incrementally reveal rows in a scroll container: show `initial` first, then load `batch`
 * more each time the sentinel intersects the scroll area (lazy load on scroll).
 */
export function useLazyScrollRows(
  totalLength: number,
  options?: { initial?: number; batch?: number; resetKey?: string | number }
) {
  const initial = options?.initial ?? DEFAULT_INITIAL
  const batch = options?.batch ?? DEFAULT_BATCH
  const resetKey = options?.resetKey
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(() => Math.min(initial, totalLength))

  // Reset when the dataset size changes (new time range / refetch) or resetKey (e.g. sort) changes
  useEffect(() => {
    setVisibleCount(Math.min(initial, totalLength))
    scrollRef.current?.scrollTo({ top: 0 })
  }, [totalLength, initial, resetKey])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || visibleCount >= totalLength || totalLength === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + batch, totalLength))
        }
      },
      { root, rootMargin: "100px", threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [totalLength, visibleCount, batch])

  const hasMore = visibleCount < totalLength

  return { scrollRef, sentinelRef, visibleCount, hasMore }
}
