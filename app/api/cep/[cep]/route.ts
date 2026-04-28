import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const RATE_LIMIT = 10
const WINDOW_MS = 60_000

type Params = { params: Promise<{ cep: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

  const { allowed } = await checkRateLimitAsync(`cep:${ip}`, {
    maxAttempts: RATE_LIMIT,
    windowMs: WINDOW_MS,
  })

  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { cep } = await params
  const cleaned = cep.replace(/\D/g, '')

  if (!/^\d{8}$/.test(cleaned)) {
    return NextResponse.json({ error: 'CEP must be 8 digits' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()

    if (data.erro) {
      return NextResponse.json({ error: 'CEP not found' }, { status: 404 })
    }

    return NextResponse.json({
      cep: data.cep,
      street: data.logradouro || '',
      complement: data.complemento || '',
      neighborhood: data.bairro || '',
      city: data.localidade || '',
      state: data.uf || '',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch CEP' }, { status: 502 })
  }
}
