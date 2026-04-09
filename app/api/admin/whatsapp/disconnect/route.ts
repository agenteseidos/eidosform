import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

function getWhatsappUrl(path: string): string {
  const base = process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br'
  return `${base}${path}`
}

function getAuthHeaders(): Record<string, string> {
  const key = process.env.WHATSAPP_API_KEY
  if (!key) {
    throw new Error('WHATSAPP_API_KEY environment variable is not set')
  }
  return {
    'Authorization': `Bearer ${key}`,
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/disconnect'), {
      method: 'POST',
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('WhatsApp disconnect proxy failed:', response.status, text)
      return NextResponse.json(
        { error: 'Failed to disconnect' },
        { status: 502 }
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: data.success !== false })
  } catch (err: unknown) {
    console.error('WhatsApp disconnect failed:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
