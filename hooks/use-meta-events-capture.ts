'use client'

import { useEffect, useState } from 'react'

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
    __eidosCapturedFbqEvents?: string[]
  }
}

/**
 * Captura nomes de eventos custom enviados via fbq (para telemetria no submit).
 *
 * Implementação: lib/pixel-events.ts (firePixelEvent / fireNamedPixelEvent) empurra
 * o nome do evento custom em `window.__eidosCapturedFbqEvents` antes de chamar fbq.
 * Este hook lê esse array em intervalo e expõe os nomes únicos.
 *
 * Por que NÃO monkey-patcheamos `window.fbq`: substituir o fbq mesmo preservando
 * propriedades internas faz o Meta detectar "Multiple pixels with conflicting versions"
 * e suprimir silenciosamente o envio de eventos pro /tr (zero requests, zero erros).
 */
export function useMetaEventsCapture(enabled: boolean) {
  const [capturedEvents, setCapturedEvents] = useState<string[]>([])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    if (!window.__eidosCapturedFbqEvents) {
      window.__eidosCapturedFbqEvents = []
    }

    const interval = setInterval(() => {
      const buf = window.__eidosCapturedFbqEvents ?? []
      if (buf.length === 0) return
      setCapturedEvents(prev => {
        const merged = new Set(prev)
        for (const name of buf) {
          if (!STANDARD_META_EVENTS.has(name)) merged.add(name)
        }
        return merged.size === prev.length ? prev : Array.from(merged)
      })
    }, 500)

    return () => clearInterval(interval)
  }, [enabled])

  return capturedEvents
}
