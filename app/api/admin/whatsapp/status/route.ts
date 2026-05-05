import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

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
      return NextResponse.json(
        { authenticated: false, connected: false, phoneNumber: null },
        { status: 200 }
      )
    }

    const data = await response.json()
    return NextResponse.json({
      authenticated: data.authenticated ?? false,
      connected: data.connected ?? data.authenticated ?? false,
      phoneNumber: data.phoneNumber ?? data.phone ?? data.jid ?? null,
    })
  } catch (err: unknown) {
    logError('WhatsApp status check failed:', err)
    return NextResponse.json(
      { authenticated: false, connected: false, phoneNumber: null },
      { status: 200 }
    )
  }
}
