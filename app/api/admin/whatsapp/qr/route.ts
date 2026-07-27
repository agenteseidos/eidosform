import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { log, logWarn, logError } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getWhatsappBase, getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

const RATE_LIMIT_MS = 30_000

export async function POST(request: NextRequest) {
  log('[QR] API called', { whatsappUrl: getWhatsappBase() });

  const auth = await requireAdmin(request)
  if (!auth.ok) {
    logWarn('[QR] Auth failed');
    return auth.response
  }
  log('[QR] Auth OK', { user: auth.user?.email || 'unknown' });

  const body = await request.json().catch(() => ({})) as { transport?: unknown }
  const transport = body.transport === 'wacli' || body.transport === 'wuzapi'
    ? body.transport
    : null
  if (!transport) {
    return NextResponse.json({ error: 'Invalid transport' }, { status: 400 })
  }

  // Rate limit
  const rateLimitKey = `admin:whatsapp:qr:${auth.user?.id ?? 'unknown'}`
  const { allowed, resetIn } = await checkRateLimitAsync(rateLimitKey, {
    maxAttempts: 1,
    windowMs: RATE_LIMIT_MS,
  })
  if (!allowed) {
    logWarn('[QR] Rate limited', { remainingMs: resetIn });
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(resetIn / 1000)} seconds.` },
      { status: 429 }
    )
  }

  const fetchUrl = getWhatsappUrl('/api/whatsapp/qr');
  log('[QR] Fetching', { fetchUrl });

  try {
    const fetchStart = Date.now();
    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        ...getWhatsappAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transport }),
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
    log('[QR] QR received', { transport, qrLength: data.qr ? data.qr.length : 0 });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err: unknown) {
    logError('[QR] Generation failed', err);
    return NextResponse.json(
      { error: 'Failed to generate QR code' },
      { status: 500 }
    )
  }
}
