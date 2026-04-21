import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { log, logWarn, logError } from '@/lib/logger'

const RATE_LIMIT_MS = 30_000
let lastQrTime = 0

function getWhatsappUrl(path: string): string {
  // Force production domain — Vercel env var may not be loaded in time
  const base = 'https://wpp.eidosform.com.br'
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
  log('[QR] API called', { whatsappUrl: process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br' });

  const auth = await requireAdmin(request)
  if (!auth.ok) {
    logWarn('[QR] Auth failed');
    return auth.response
  }
  log('[QR] Auth OK', { user: auth.user?.email || 'unknown' });

  // Rate limit
  const now = Date.now()
  const remaining = RATE_LIMIT_MS - (now - lastQrTime)
  if (remaining > 0) {
    logWarn('[QR] Rate limited', { remainingMs: remaining });
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(remaining / 1000)} seconds.` },
      { status: 429 }
    )
  }
  lastQrTime = now

  const fetchUrl = getWhatsappUrl('/api/whatsapp/qr');
  log('[QR] Fetching', { fetchUrl });

  try {
    const fetchStart = Date.now();
    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    const fetchTime = Date.now() - fetchStart;
    log('[QR] Fetch response', { status: response.status, timeMs: fetchTime, contentType: response.headers.get('content-type') });

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logError('[QR] Fetch failed', null, { status: response.status, body: text.substring(0, 500) });
      return NextResponse.json(
        { error: 'Failed to generate QR code' },
        { status: 502 }
      )
    }

    const data = await response.json()
    log('[QR] QR received', { qrLength: data.qr ? data.qr.length : 0 });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err: unknown) {
    logError('[QR] Generation failed', err);
    return NextResponse.json(
      { error: 'Failed to generate QR code', debug: String(err) },
      { status: 500 }
    )
  }
}
