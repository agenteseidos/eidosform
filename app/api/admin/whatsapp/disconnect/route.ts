import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({})) as { transport?: unknown }
  const transport = body.transport === 'wacli' || body.transport === 'wuzapi'
    ? body.transport
    : null
  if (!transport) {
    return NextResponse.json({ error: 'Invalid transport' }, { status: 400 })
  }

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/disconnect'), {
      method: 'POST',
      headers: {
        ...getWhatsappAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transport }),
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
