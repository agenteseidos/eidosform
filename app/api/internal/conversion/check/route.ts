import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { sendBillingOpsAlert } from '@/lib/resend'
import {
  decidirEstadoConta,
  type ConversionProfile,
} from '@/lib/conversion-check'
import { normalizarTelefoneBR } from '@/lib/migracao/regua'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
// Trade-off aprovado pelo Sidney: o endpoint interno distingue free de none.
// A resposta continua mínima e nunca devolve plano, status, identidade ou PII.
const UNKNOWN = { ok: false, state: 'unknown' as const }
const PROFILE_COLS = 'id, plan, plan_status, plan_cycle, plan_expires_at'

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}

function autorizado(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ') || !secret) return false
  const recebido = Buffer.from(header.slice(7).trim())
  const esperado = Buffer.from(secret)
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

async function alertarTetoGlobal() {
  const dia = new Date().toISOString().slice(0, 10)
  const { error } = await getServiceClient()
    .from('asaas_webhook_events')
    .insert({ event_id: `conversion-check-teto:${dia}`, event: 'CONVERSION_CHECK_TETO', status: 'processed' })
  if (!error) {
    sendBillingOpsAlert({
      subject: 'conversion/check: teto global atingido — possível abuso',
      lines: { endpoint: '/api/internal/conversion/check', teto: '300/15min' },
    }).catch(() => {})
  }
}

async function buscarProfiles(phoneKey: string): Promise<{
  profiles: ConversionProfile[] | null
  errorCode?: string
  truncated?: boolean
}> {
  const sb = getServiceClient()
  const [diretos, snapshots] = await Promise.all([
    sb.from('profiles')
      .select(PROFILE_COLS)
      .eq('phone_match_key_br', phoneKey)
      .limit(21),
    sb.from('billing_checkouts')
      .select('profile_id')
      .eq('billing_phone_match_key_br', phoneKey)
      .limit(21),
  ])
  if (diretos.error || snapshots.error) {
    return { profiles: null, errorCode: diretos.error?.code || snapshots.error?.code || 'db_error' }
  }

  const diretosRows = (diretos.data ?? []) as unknown as ConversionProfile[]
  const snapshotRows = snapshots.data ?? []
  const truncated = diretosRows.length > 20 || snapshotRows.length > 20
  const encontrados = new Map<string, ConversionProfile>()
  for (const row of diretosRows.slice(0, 20)) encontrados.set(row.id, row)
  const faltantes = [...new Set(
    snapshotRows.slice(0, 20)
      .map((row) => String((row as { profile_id?: unknown }).profile_id ?? ''))
      .filter((id) => id && !encontrados.has(id)),
  )]

  if (faltantes.length) {
    const porSnapshot = await sb.from('profiles').select(PROFILE_COLS).in('id', faltantes).limit(20)
    if (porSnapshot.error) return { profiles: null, errorCode: porSnapshot.error.code || 'db_error' }
    for (const row of (porSnapshot.data ?? []) as unknown as ConversionProfile[]) encontrados.set(row.id, row)
  }
  return { profiles: [...encontrados.values()], truncated }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.FOLLOWUP_CONVERSION_SECRET || ''
  if (!autorizado(req, secret)) {
    return NextResponse.json(UNKNOWN, { status: 401, headers: NO_STORE })
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 4096) {
    return NextResponse.json(UNKNOWN, { status: 413, headers: NO_STORE })
  }

  let body: { phone?: unknown }
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > 4096) {
      return NextResponse.json(UNKNOWN, { status: 413, headers: NO_STORE })
    }
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json(UNKNOWN, { status: 400, headers: NO_STORE })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(UNKNOWN, { status: 400, headers: NO_STORE })
  }
  const phoneKey = normalizarTelefoneBR(body.phone)
  if (!phoneKey) {
    return NextResponse.json(UNKNOWN, { status: 400, headers: NO_STORE })
  }

  // HMAC, não hash simples: telefone tem espaço de busca pequeno. O valor cru
  // nunca entra em log, chave de rate-limit, erro ou métrica.
  const rateKey = createHmac('sha256', secret).update(`phone:${phoneKey}`).digest('hex').slice(0, 32)
  const individual = await checkRateLimitAsync(`conversion:${rateKey}`, {
    maxAttempts: 6,
    windowMs: 15 * 60 * 1000,
  })
  if (!individual.allowed) {
    return NextResponse.json(UNKNOWN, {
      status: 429,
      headers: { ...NO_STORE, 'Retry-After': Math.ceil(individual.resetIn / 1000).toString() },
    })
  }
  const global = await checkRateLimitAsync('conversion:__global__', {
    maxAttempts: 300,
    windowMs: 15 * 60 * 1000,
  })
  if (!global.allowed) {
    console.warn('[conversion/check] teto global atingido')
    alertarTetoGlobal().catch(() => {})
    return NextResponse.json(UNKNOWN, {
      status: 429,
      headers: { ...NO_STORE, 'Retry-After': Math.ceil(global.resetIn / 1000).toString() },
    })
  }

  const lookup = await buscarProfiles(phoneKey)
  if (!lookup.profiles) {
    console.error('[conversion/check] lookup falhou', { code: lookup.errorCode || 'db_error' })
    return NextResponse.json(UNKNOWN, { status: 500, headers: NO_STORE })
  }

  const state = lookup.truncated ? 'unknown' : decidirEstadoConta(lookup.profiles)
  return NextResponse.json({ ok: true, state }, { status: 200, headers: NO_STORE })
}
