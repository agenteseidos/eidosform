import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

function getWhatsappUrl(path: string): string {
  const base = process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br'
  return `${base}${path}`
}

function getAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY || ''}`,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/status'), {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      console.error('WhatsApp status proxy failed:', response.status)
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
    console.error('WhatsApp status check failed:', err)
    return NextResponse.json(
      { authenticated: false, connected: false, phoneNumber: null },
      { status: 200 }
    )
  }
}
