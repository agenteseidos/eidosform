import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

const RATE_LIMIT_MS = 30_000
let lastQrTime = 0

function getWhatsappUrl(path: string): string {
  // Force production domain — Vercel env var may not be loaded in time
  const base = 'https://wpp.eidosform.com.br'
  return `${base}${path}`
}

function getAuthHeaders(): Record<string, string> {
  const key = process.env.WHATSAPP_API_KEY || 'd740b16263d6e361d169d5a9b0a7c714054160f069756eff60456ee20b8d6d76'
  return {
    'Authorization': `Bearer ${key}`,
  }
}

export async function POST(request: NextRequest) {
  const ts = new Date().toISOString();
  const whatsappUrl = process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br';
  console.log(`[${ts}] [QR] API called. WHATSAPP_API_URL: ${whatsappUrl}`);

  const auth = await requireAdmin(request)
  if (!auth.ok) {
    console.log(`[${ts}] [QR] Auth failed.`);
    return auth.response
  }
  console.log(`[${ts}] [QR] Auth OK. User: ${auth.user?.email || 'unknown'}`);

  // Rate limit
  const now = Date.now()
  const remaining = RATE_LIMIT_MS - (now - lastQrTime)
  if (remaining > 0) {
    console.log(`[${ts}] [QR] Rate limited. Remaining: ${remaining}ms`);
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(remaining / 1000)} seconds.` },
      { status: 429 }
    )
  }
  lastQrTime = now

  const fetchUrl = getWhatsappUrl('/api/whatsapp/qr');
  console.log(`[${ts}] [QR] Fetching: ${fetchUrl}`);

  try {
    const fetchStart = Date.now();
    const response = await fetch(fetchUrl, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    const fetchTime = Date.now() - fetchStart;
    console.log(`[${ts}] [QR] Fetch response: status=${response.status}, time=${fetchTime}ms, content-type=${response.headers.get('content-type')}`);

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error(`[${ts}] [QR] Fetch failed. Status: ${response.status}. Body (first 500): ${text.substring(0, 500)}`);
      return NextResponse.json(
        { error: 'Failed to generate QR code' },
        { status: 502 }
      )
    }

    const data = await response.json()
    console.log(`[${ts}] [QR] QR received: ${data.qr ? data.qr.length : 0} chars`);

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error(`[${ts}] [QR] Generation failed. Error:`, err);
    return NextResponse.json(
      { error: 'Failed to generate QR code', debug: String(err) },
      { status: 500 }
    )
  }
}
