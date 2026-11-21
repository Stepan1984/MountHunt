import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

function scrollToHashTarget(hash: string): boolean {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id) return false
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

/**
 * Scroll to the location hash after route/data are ready.
 * Also resets to top when navigating to a path without a hash
 * (React Router does not restore scroll by default).
 */
export function ScrollToHash({ ready }: { ready: boolean }) {
  const { pathname, hash, key } = useLocation()

  useEffect(() => {
    if (!ready) return

    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
      return
    }

    let cancelled = false
    let attempts = 0
    let raf = 0

    const tryScroll = () => {
      if (cancelled) return
      if (scrollToHashTarget(hash)) return
      attempts += 1
      if (attempts < 60) {
        raf = window.requestAnimationFrame(tryScroll)
      }
    }

    // Wait one frame so the matched route can paint first.
    raf = window.requestAnimationFrame(tryScroll)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
    }
  }, [pathname, hash, key, ready])

  return null
}
