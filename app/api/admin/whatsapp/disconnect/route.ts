import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/disconnect'), {
      method: 'POST',
      headers: getWhatsappAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logError('WhatsApp disconnect proxy failed:', undefined, { status: response.status, text })
      return NextResponse.json(
        { error: 'Failed to disconnect' },
        { status: 502 }
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: data.success !== false })
  } catch (err: unknown) {
    logError('WhatsApp disconnect failed:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
