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

      // Replica a lógica interna do stub original do Meta Pixel: se fbevents.js já carregou
      // (callMethod presente), delega; senão, empurra pra queue. Isso é CRÍTICO porque
      // o fbevents.js atualiza `callMethod` em `window.fbq` (que será o patchedFbq),
      // não em `originalFbq`. Se o patched delegasse pra originalFbq, os events ficariam
      // presos na queue do stub eternamente e nunca chegariam ao /tr do Facebook.
      const patchedFbq = function (this: unknown, ...args: unknown[]) {
        const [command, eventName] = args

        if (command === 'track' && typeof eventName === 'string' && !STANDARD_META_EVENTS.has(eventName)) {
          setCapturedEvents(prev => (prev.includes(eventName) ? prev : [...prev, eventName]))
        }

        const self = patchedFbq as unknown as { callMethod?: (...a: unknown[]) => unknown; queue: unknown[] }
        if (self.callMethod) {
          return self.callMethod.apply(self, args)
        }
        self.queue.push(args)
      } as unknown as typeof window.fbq

      // Copia propriedades internas (queue, loaded, version, callMethod se já existir, push, _fbq)
      // do fbq original pro patched. fbevents.js, quando rodar, vai atualizar callMethod
      // em window.fbq (= patchedFbq), e o nosso wrapper vai delegar via self.callMethod.
      Object.assign(patchedFbq as object, originalFbq)

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
