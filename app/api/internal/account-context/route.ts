import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { normalizarTelefoneBR } from '@/lib/migracao/regua'
import { normalizePlan } from '@/lib/plans'

/**
 * POST /api/internal/account-context — FICHA DA CONTA para o atendimento
 * (Elen), consultada por telefone no INBOUND de conversa.
 *
 * Pacote 2 (decisão Sidney 30/07, desenho endurecido pelo parecer Codex):
 *  - Endpoint SEPARADO do /internal/conversion/check, com SEGREDO PRÓPRIO
 *    (`ELEN_ACCOUNT_CONTEXT_SECRET`): o conversion/check serve à CAMPANHA,
 *    devolve só um estado grosseiro de propósito e tem consumidor com
 *    validação estrita — enriquecê-lo quebraria contrato e a separação
 *    deliberada campanha × atendimento.
 *  - A ficha é CONTEXTO DE PERSONALIZAÇÃO, NUNCA autenticação: e-mail
 *    confirmado NÃO prova posse do telefone (um atacante pode confirmar o
 *    PRÓPRIO e-mail tendo informado o telefone da vítima). O consumidor
 *    (cérebro da Elen) usa para saudação/contexto; jamais para autorizar
 *    mudanças, revelar cobrança espontaneamente ou decidir algo sensível.
 *  - `nome` é DADO NÃO CONFIÁVEL (digitado no cadastro): sanitizado aqui
 *    (controle/whitespace/limite) e delimitado como DADO no prompt do
 *    consumidor — nunca interpolado como instrução.
 *  - Ficha SÓ com match ÚNICO entre perfis CONFIRMADOS; ambiguidade,
 *    truncamento ou não-confirmado → `ficha: null` (sem vazamento).
 *  - Enums fechados; data estrita YYYY-MM-DD (dia BRT); nada de e-mail,
 *    CPF, ids Asaas ou valores brutos em log.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const NEGADO = { ok: false as const }

function autorizado(req: NextRequest): boolean {
  const secret = process.env.ELEN_ACCOUNT_CONTEXT_SECRET || ''
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const recebido = Buffer.from(token)
  const esperado = Buffer.from(secret)
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

type FichaStatus = 'active' | 'canceling' | 'cancelled' | 'expired' | 'unknown'

/** Sanitização do nome: remove controle, colapsa espaço, limita tamanho. */
export function sanitizarNome(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const limpo = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim()
  return limpo.length >= 2 ? limpo : null
}

/** Dia BRT em formato estrito YYYY-MM-DD, ou null. */
export function diaBRT(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Recife' })
}

type ProfileRow = {
  full_name: string | null
  plan: string | null
  plan_status: string | null
  plan_cycle: string | null
  plan_expires_at: string | null
  email_confirmed_at: string | null
}

export function derivarStatus(p: ProfileRow): FichaStatus {
  const plan = normalizePlan(p.plan)
  const st = String(p.plan_status ?? '').trim().toLowerCase()
  if (plan !== 'free' && p.plan_expires_at) {
    const exp = new Date(p.plan_expires_at).getTime()
    if (!Number.isNaN(exp) && exp <= Date.now()) return 'expired'
  }
  if (st === 'active') return 'active'
  if (st === 'canceling') return 'canceling'
  if (st === 'cancelled') return 'cancelled'
  return 'unknown'
}

export function montarFicha(p: ProfileRow) {
  const ciclo = p.plan_cycle === 'MONTHLY' || p.plan_cycle === 'YEARLY' ? p.plan_cycle : null
  return {
    nome: sanitizarNome(p.full_name),
    plano: normalizePlan(p.plan),
    ciclo,
    status: derivarStatus(p),
    acesso_ate: diaBRT(p.plan_expires_at),
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json(NEGADO, { status: 401, headers: NO_STORE })
  }

  let body: { phone?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(NEGADO, { status: 400, headers: NO_STORE })
  }
  const phoneKey = normalizarTelefoneBR(body?.phone)
  if (!phoneKey) {
    return NextResponse.json(NEGADO, { status: 400, headers: NO_STORE })
  }

  // Rate limit por HMAC do telefone (valor cru nunca vira chave/log) + global.
  // O consumidor DEVE cachear a ficha por conversa (10-15min) — sem cache,
  // 6/15min estoura numa conversa longa (parecer Codex).
  const secret = process.env.ELEN_ACCOUNT_CONTEXT_SECRET || ''
  const rateKey = createHmac('sha256', secret).update(`ficha:${phoneKey}`).digest('hex').slice(0, 32)
  const individual = await checkRateLimitAsync(`account-context:${rateKey}`, {
    maxAttempts: 6,
    windowMs: 15 * 60 * 1000,
  })
  if (!individual.allowed) {
    return NextResponse.json(NEGADO, {
      status: 429,
      headers: { ...NO_STORE, 'Retry-After': Math.ceil(individual.resetIn / 1000).toString() },
    })
  }
  const global = await checkRateLimitAsync('account-context:__global__', {
    maxAttempts: 300,
    windowMs: 15 * 60 * 1000,
  })
  if (!global.allowed) {
    return NextResponse.json(NEGADO, { status: 429, headers: NO_STORE })
  }

  try {
    const db = createAdminClient()
    // limite 3: só precisamos distinguir 0, 1 e "mais de 1".
    const { data, error } = await db
      .from('profiles')
      .select('full_name, plan, plan_status, plan_cycle, plan_expires_at, email_confirmed_at')
      .eq('phone_match_key_br', phoneKey)
      .limit(3)

    if (error) {
      return NextResponse.json({ ok: true, ficha: null }, { status: 200, headers: NO_STORE })
    }

    // Match único ENTRE CONFIRMADOS: cadastro sem e-mail confirmado não conta
    // (mitiga cadastro-fantasma do P1-3; a posse REAL do telefone só virá com
    // OTP — até lá a ficha é contexto fraco por contrato).
    const confirmados = (data ?? []).filter((p) => p.email_confirmed_at) as ProfileRow[]
    if (confirmados.length !== 1) {
      return NextResponse.json({ ok: true, ficha: null }, { status: 200, headers: NO_STORE })
    }

    return NextResponse.json({ ok: true, ficha: montarFicha(confirmados[0]) }, { status: 200, headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: true, ficha: null }, { status: 200, headers: NO_STORE })
  }
}
