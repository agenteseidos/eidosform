'use client'

import { useEffect, useRef, useState } from 'react'

const STANDARD_META_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Search',
  'AddToCart',
  'AddToWishlist',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Purchase',
  'Lead',
  'CompleteRegistration',
])

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

export function useMetaEventsCapture(enabled: boolean) {
  const [capturedEvents, setCapturedEvents] = useState<string[]>([])
  const originalFbqRef = useRef<((...args: unknown[]) => void) | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    if (window.fbq && !originalFbqRef.current) {
      const originalFbq = window.fbq
      originalFbqRef.current = originalFbq

      const patchedFbq = ((...args: unknown[]) => {
        const [command, eventName] = args

        if (command === 'track' && typeof eventName === 'string' && !STANDARD_META_EVENTS.has(eventName)) {
          setCapturedEvents(prev => (prev.includes(eventName) ? prev : [...prev, eventName]))
        }

        return originalFbq(...args)
      })

      window.fbq = patchedFbq
    }

    return () => {
      if (originalFbqRef.current && window.fbq) {
        window.fbq = originalFbqRef.current
      }
    }
  }, [enabled])

  return capturedEvents
}
