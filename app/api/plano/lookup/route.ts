import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createHash } from 'crypto'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { resolverPlanoAtual } from '@/lib/migracao/decisao'
import { normalizarEmail } from '@/lib/migracao/regua'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

function isInternal(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  if (!h?.startsWith('Bearer ')) return false
  const token = h.slice(7).trim()
  return !!process.env.INTERNAL_API_SECRET && token === process.env.INTERNAL_API_SECRET
}

/**
 * POST /api/plano/lookup — INTERNO (Bearer INTERNAL_API_SECRET). "Item 2" da Elen:
 * consulta do plano da conta no CHAT GERAL (fora do fluxo de migração).
 * Body: { email } → { ok, existe, planoAtual?, cicloAtual?, situacao }
 *   situacao: 'ativa' | 'cancelando' | 'indeterminada'
 *
 * Desenho híbrido aprovado (Codex 2026-07-01): a IA só SINALIZA a intenção com marcador
 * SEM e-mail; o e-mail é extraído pelo CÓDIGO só de mensagens do USUÁRIO; este endpoint
 * responde o MÍNIMO (tier+ciclo+situação — sem ids, nome, pagamentos, cliente Asaas).
 *
 * ⚠️ RISCO ACEITO (Sidney, 2026-07-01): consulta por e-mail NÃO verifica posse do e-mail
 * (sem OTP). Decisão consciente (só leitura, dado de baixa sensibilidade). NÃO tratar como
 * bug/vazamento em auditoria. Pré-requisito de operação (cadeado do webhook) ATIVADO em
 * 2026-07-02 antes desta feature entrar no ar.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isInternal(req)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  let body: { email?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE })
  }
  const emailRaw = String(body?.email ?? '')
  if (emailRaw.length < 5 || emailRaw.length > 120 || !emailRaw.includes('@')) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE })
  }
  const email = normalizarEmail(emailRaw)

  // Rate-limit: por e-mail (anti-enumeração dirigida) + global (anti-abuso distribuído).
  // Chave HASHEADA (Codex 2026-07-02 P3): o e-mail em claro não precisa virar chave de storage.
  const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 24)
  const rlEmail = await checkRateLimitAsync(`plano:${emailHash}`, { maxAttempts: 6, windowMs: 15 * 60 * 1000 })
  if (!rlEmail.allowed) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: NO_STORE })
  }
  const rlGlobal = await checkRateLimitAsync('plano:__global__', { maxAttempts: 300, windowMs: 15 * 60 * 1000 })
  if (!rlGlobal.allowed) {
    console.warn('[plano/lookup] teto GLOBAL de rate-limit atingido (possível abuso)')
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: NO_STORE })
  }

  const sb = getServiceClient()
  const { data: prof, error: profErr } = await sb
    .from('profiles')
    .select('plan, plan_status, plan_cycle, plan_expires_at')
    .eq('email', email)
    .maybeSingle()

  if (profErr) {
    // PGRST116 = e-mail duplicado (profiles.email não é unique) → fail-closed, sem plano.
    if ((profErr as { code?: string }).code === 'PGRST116') {
      return NextResponse.json({ ok: true, existe: true, situacao: 'indeterminada' }, { status: 200, headers: NO_STORE })
    }
    console.error('[plano/lookup] lookup falhou (transitório):', profErr.message)
    return NextResponse.json({ ok: false, reason: 'erro' }, { status: 500, headers: NO_STORE })
  }
  if (!prof) {
    return NextResponse.json({ ok: true, existe: false }, { status: 200, headers: NO_STORE })
  }

  const res = resolverPlanoAtual(prof)
  if (res.indeterminado) {
    return NextResponse.json({ ok: true, existe: true, situacao: 'indeterminada' }, { status: 200, headers: NO_STORE })
  }
  return NextResponse.json(
    {
      ok: true,
      existe: true,
      planoAtual: res.plano,
      cicloAtual: res.ciclo,
      situacao: res.cancelando ? 'cancelando' : 'ativa',
    },
    { status: 200, headers: NO_STORE }
  )
}
