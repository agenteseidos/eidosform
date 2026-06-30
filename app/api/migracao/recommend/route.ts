import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { MIGRACAO, validarContratoForm } from '@/lib/migracao/config'
import { recomendarPlano, normalizarTelefoneBR, normalizarEmail } from '@/lib/migracao/regua'
import type { QuestionConfig } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// Auth server-to-server (mesmo padrão de /api/whatsapp/send).
function isInternal(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  if (!h?.startsWith('Bearer ')) return false
  const token = h.slice(7).trim()
  return !!process.env.INTERNAL_API_SECRET && token === process.env.INTERNAL_API_SECRET
}

// Texto controlado pelo usuário (nome/opções) → tira caracteres de controle/quebras e limita
// tamanho. Defesa contra prompt-injection já na borda (a Elen reforça do lado dela).
function sanitizar(s: unknown, max = 60): string {
  const semControle = Array.from(String(s ?? ''))
    .filter((c) => {
      const n = c.charCodeAt(0)
      return n >= 32 && n !== 127
    })
    .join('')
  return semControle.replace(/\s+/g, ' ').trim().slice(0, max)
}

// Mesmo envelope p/ "telefone não encontrado" e "e-mail errado" (anti-enumeração).
const naoConfirmado = () =>
  NextResponse.json({ ok: false, reason: 'nao_confirmado' }, { status: 200, headers: NO_STORE })

/**
 * POST /api/migracao/recommend  — INTERNO (Bearer INTERNAL_API_SECRET).
 * Body: { phone, email }  (phone = telefone real do remetente; email = digitado na conversa).
 * ⚠️ NÃO é verificação de identidade: telefone e e-mail vêm da MESMA submissão pública, então o
 * e-mail é só SELETOR/desambiguador da submissão (não prova posse de conta). Por isso NÃO consulta
 * nem devolve dado de conta. Mesmo envelope p/ telefone-inexistente e e-mail-errado (anti-enumeração).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isInternal(req)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  // 1) valida tamanho/formato do body ANTES do rate-limit
  let body: { phone?: unknown; email?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE })
  }
  const phoneRaw = String(body?.phone ?? '')
  const emailRaw = String(body?.email ?? '')
  if (
    phoneRaw.length < 8 || phoneRaw.length > 24 ||
    emailRaw.length < 5 || emailRaw.length > 120 || !emailRaw.includes('@')
  ) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE })
  }
  const phone = normalizarTelefoneBR(phoneRaw)
  const email = normalizarEmail(emailRaw)
  if (phone.length < 8) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE })
  }

  // 2) rate-limit: por telefone canônico (5/15min) + teto GLOBAL (anti-abuso com vários telefones)
  const rlPhone = await checkRateLimitAsync(`migracao:${phone}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
  if (!rlPhone.allowed) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: NO_STORE })
  }
  const rlGlobal = await checkRateLimitAsync('migracao:__global__', { maxAttempts: 200, windowMs: 15 * 60 * 1000 })
  if (!rlGlobal.allowed) {
    console.warn('[migracao] teto GLOBAL de rate-limit atingido (possível abuso)')
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: NO_STORE })
  }

  const sb = getServiceClient()

  // 3) contrato do form (IDs/tipos/condicionais ainda batem?)
  const { data: form, error: formErr } = await sb
    .from('forms')
    .select('id, slug, questions')
    .eq('id', MIGRACAO.formId)
    .single()
  if (formErr || !form || form.slug !== MIGRACAO.slug) {
    console.error('[migracao] form não encontrado ou slug divergente', formErr?.message ?? '')
    return NextResponse.json({ ok: false, reason: 'config' }, { status: 503, headers: NO_STORE })
  }
  const contrato = validarContratoForm(form.questions as unknown as QuestionConfig[])
  if (!contrato.ok) {
    console.error('[migracao] contrato do form divergente:', contrato.erros.join(' | '))
    return NextResponse.json({ ok: false, reason: 'config' }, { status: 503, headers: NO_STORE })
  }

  // 4) respostas na JANELA DE ELEGIBILIDADE (90d) + teto-backstop de 2000 (mais recentes).
  //    Sem falso negativo no volume atual; se o form passar de 2000/90d, as MAIS ANTIGAS
  //    são truncadas → migrar p/ RPC (warning abaixo). Hoje (form novo) é folgadíssimo.
  const cutoff = new Date(Date.now() - MIGRACAO.eligibilityDays * 86400000).toISOString()
  const { data: rows, error: respErr } = await sb
    .from('responses')
    .select('id, answers, submitted_at')
    .eq('form_id', MIGRACAO.formId)
    .eq('completed', true)
    .gte('submitted_at', cutoff)
    .order('submitted_at', { ascending: false })
    .limit(2000)
  if (respErr) {
    console.error('[migracao] erro ao ler responses:', respErr.message)
    return NextResponse.json({ ok: false, reason: 'erro' }, { status: 500, headers: NO_STORE })
  }
  if ((rows?.length ?? 0) >= 2000) {
    console.warn('[migracao] janela atingiu o teto de 2000 respostas — migrar p/ RPC')
  }

  // 5) match em 2 sinais CONJUNTOS (telefone E e-mail na MESMA resposta); mais recente entre as válidas
  const q = MIGRACAO.q
  const match = (rows ?? []).find((r) => {
    const a = (r.answers ?? {}) as Record<string, unknown>
    if (normalizarTelefoneBR(a[q.telefone]) !== phone) return false
    // Integridade: compara o e-mail SÓ do ramo declarado em "já tem conta?" (o outro campo,
    // numa submissão legítima, está vazio). Ramo ausente/contraditório → inválido.
    const ja = String(a[q.jaConta] ?? '').trim().toLowerCase()
    if (ja === 'sim') return normalizarEmail(a[q.emailSim]) === email
    if (ja === 'não' || ja === 'nao') return normalizarEmail(a[q.emailNao]) === email
    return false
  })
  if (!match) return naoConfirmado()

  const a = (match.answers ?? {}) as Record<string, unknown>
  const jaTemConta = String(a[q.jaConta] ?? '').trim().toLowerCase() === 'sim'

  const usage = {
    respostasMes: a[q.respostasMes],
    maiorForm: a[q.maiorForm],
    qtdForms: a[q.qtdForms],
    recursos: a[q.recursos],
  }
  const { tier, flags } = recomendarPlano(usage)
  const flagSet = new Set(flags)

  // 6) ⚠️ SEGURANÇA — NÃO consultamos a conta pelo e-mail DIGITADO. O form é público e
  // autossubmetido: telefone E e-mail vêm da MESMA submissão, então o e-mail NÃO prova
  // posse independente da conta (a "verificação em 2 sinais" original era ilusória).
  // Revelar plano/ciclo a partir desse e-mail vazaria dado de TERCEIRO (basta conhecer o
  // e-mail da vítima). Por isso a recomendação usa SÓ o uso informado no form; o "plano
  // atual" não é consultado nem devolvido. (Comparar com o plano atual com segurança
  // exigiria verificação out-of-band do e-mail — ex.: OTP — fica como evolução futura.)

  // 7) motivo (enum primário)
  let motivo: string
  if (flagSet.has('acima_do_limite')) motivo = 'acima_do_limite'
  else if (flagSet.has('requer_analise') || flagSet.has('acima_do_beneficio')) motivo = 'requer_analise'
  else if (jaTemConta) motivo = 'upgrade'
  else motivo = 'assinar'

  return NextResponse.json(
    {
      ok: true,
      nome: sanitizar(a[q.nome], 60),
      jaTemConta,
      planoRecomendado: tier,
      motivo,
      flags: Array.from(flagSet),
      resumoUso: {
        respostasMes: sanitizar(usage.respostasMes, 40),
        maiorForm: sanitizar(usage.maiorForm, 40),
        ferramenta: sanitizar(a[q.ferramenta], 40),
        qtdForms: sanitizar(usage.qtdForms, 10),
        recursos: Array.isArray(usage.recursos)
          ? usage.recursos.map((x) => sanitizar(x, 50)).slice(0, 12)
          : [],
      },
    },
    { status: 200, headers: NO_STORE }
  )
}
