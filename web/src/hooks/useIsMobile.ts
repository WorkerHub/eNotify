import { useState, useEffect } from 'react'

const MOBILE_BREAKPOINT = '(max-width: 767px)'

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_BREAKPOINT).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}
