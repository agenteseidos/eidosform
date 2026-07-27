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
} as const

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
    })
  } catch (err: unknown) {
    logError('WhatsApp status check failed:', err)
    return NextResponse.json(unavailableStatus, { status: 200 })
  }
}
