import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

const unavailableStatus = {
  authenticated: false,
  connected: false,
  phoneNumber: null,
  primaryTransport: 'wacli',
  fallbackTransport: null,
  activeTransport: 'wacli',
  activeSince: null,
  fallbackActive: false,
  fallbackReason: null,
  fallbackIncident: null,
  transports: {
    wacli: { authenticated: false, connected: false, phoneNumber: null, available: false, error: 'service_unavailable' },
    wuzapi: { authenticated: false, connected: false, phoneNumber: null, available: false, error: 'service_unavailable' },
  },
  volume: { today: 0, average7Days: 0, coverageDays: 0, elevated: false },
  sendsByTransport: { wacli: 0, wuzapi: 0, fallback: 0, legacy: 0 },
  daily: {},
  transportAttributionSince: null,
} as const

/**
 * Esta rota é uma LISTA BRANCA: reconstrói a resposta campo a campo em vez de
 * repassar o que a VPS mandou. É proposital (nada cru da VPS chega ao
 * navegador), mas tem um custo que já mordeu uma vez: campo novo na VPS que
 * não for adicionado AQUI simplesmente some, sem erro nenhum — a tela mostra
 * zero e parece dado real. Foi o que aconteceu com `daily` em 27/07: "envios
 * hoje 39" e "envios por motor 0" na mesma tela.
 * ⚠️ Ao acrescentar campo no /api/whatsapp/status da VPS, acrescente aqui também.
 */
function sanitizeDaily(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, Record<string, number>> = {}
  for (const [dia, contadores] of Object.entries(value as Record<string, unknown>)) {
    // Só chaves de data no formato esperado; o resto é descartado.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue
    const c = (contadores && typeof contadores === 'object' ? contadores : {}) as Record<string, unknown>
    out[dia] = {
      total: Number(c.total) || 0,
      wacli: Number(c.wacli) || 0,
      wuzapi: Number(c.wuzapi) || 0,
      fallback: Number(c.fallback) || 0,
      legacy: Number(c.legacy) || 0,
      failed: Number(c.failed) || 0,
    }
  }
  return out
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/status'), {
      headers: getWhatsappAuthHeaders(),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      logError('WhatsApp status proxy failed:', undefined, { status: response.status })
      return NextResponse.json(unavailableStatus, { status: 200 })
    }

    const data = await response.json()
    const sanitizeTransport = (value: unknown) => {
      const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
      return {
        authenticated: item.authenticated === true,
        connected: item.connected === true,
        phoneNumber: typeof item.phoneNumber === 'string' ? item.phoneNumber : null,
        available: item.available !== false,
        error: typeof item.error === 'string' ? item.error : null,
      }
    }

    return NextResponse.json({
      authenticated: data.authenticated ?? false,
      connected: data.connected ?? data.authenticated ?? false,
      phoneNumber: data.phoneNumber ?? data.phone ?? data.jid ?? null,
      primaryTransport: data.primaryTransport === 'wuzapi' ? 'wuzapi' : 'wacli',
      fallbackTransport: data.fallbackTransport === 'wacli' || data.fallbackTransport === 'wuzapi'
        ? data.fallbackTransport
        : null,
      activeTransport: data.activeTransport === 'wuzapi' ? 'wuzapi' : 'wacli',
      activeSince: typeof data.activeSince === 'string' ? data.activeSince : null,
      fallbackActive: data.fallbackActive === true,
      fallbackReason: typeof data.fallbackReason === 'string' ? data.fallbackReason : null,
      fallbackIncident: data.fallbackIncident && typeof data.fallbackIncident === 'object'
        ? data.fallbackIncident
        : null,
      transports: {
        wacli: sanitizeTransport(data.transports?.wacli),
        wuzapi: sanitizeTransport(data.transports?.wuzapi),
      },
      volume: {
        today: Number(data.volume?.today) || 0,
        average7Days: Number(data.volume?.average7Days) || 0,
        coverageDays: Number(data.volume?.coverageDays) || 0,
        elevated: data.volume?.elevated === true,
      },
      sendsByTransport: {
        wacli: Number(data.sendsByTransport?.wacli) || 0,
        wuzapi: Number(data.sendsByTransport?.wuzapi) || 0,
        fallback: Number(data.sendsByTransport?.fallback) || 0,
        legacy: Number(data.sendsByTransport?.legacy) || 0,
      },
      daily: sanitizeDaily(data.daily),
      transportAttributionSince: typeof data.transportAttributionSince === 'string'
        ? data.transportAttributionSince
        : null,
    })
  } catch (err: unknown) {
    logError('WhatsApp status check failed:', err)
    return NextResponse.json(unavailableStatus, { status: 200 })
  }
}
