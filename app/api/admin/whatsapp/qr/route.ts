import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

const RATE_LIMIT_MS = 60_000
let lastQrTime = 0

function getWhatsappUrl(path: string): string {
  const base = process.env.WHATSAPP_API_URL || 'http://localhost:3456'
  return `${base}${path}`
}

function getAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY || ''}`,
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  // Rate limit
  const now = Date.now()
  const remaining = RATE_LIMIT_MS - (now - lastQrTime)
  if (remaining > 0) {
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(remaining / 1000)} seconds.` },
      { status: 429 }
    )
  }
  lastQrTime = now

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/qr'), {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('WhatsApp QR proxy failed:', response.status, text)
      return NextResponse.json(
        { error: 'Failed to generate QR code' },
        { status: 502 }
      )
    }

    const pngBuffer = await response.arrayBuffer()

    return new Response(new Uint8Array(pngBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error('WhatsApp QR generation failed:', err)
    return NextResponse.json(
      { error: 'Failed to generate QR code' },
      { status: 500 }
    )
  }
}
