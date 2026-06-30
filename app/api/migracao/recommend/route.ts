import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getEffectivePlan, planAtLeast, type PlanId } from '@/lib/plans'
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
 * Verificação em DOIS sinais: a busca PARTE do telefone do remetente e o e-mail CONFIRMA.
 * Devolve só o necessário p/ a Elen recomendar o plano. Nunca distingue qual sinal falhou.
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

  // 2) rate-limit por telefone canônico (5 / 15min)
  const rl = await checkRateLimitAsync(`migracao:${phone}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
  if (!rl.allowed) {
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

  // 4) respostas na JANELA DE ELEGIBILIDADE (busca TODAS no período — sem top-N → sem falso negativo)
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
    return normalizarEmail(a[q.emailSim]) === email || normalizarEmail(a[q.emailNao]) === email
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

  // 6) plano efetivo com plan_status EXPLÍCITO (getEffectivePlan só cobre plan+expiração)
  let planoAtual: PlanId | null = null
  let cicloAtual: 'MONTHLY' | 'YEARLY' | null = null
  if (jaTemConta) {
    const { data: prof } = await sb
      .from('profiles')
      .select('plan, plan_status, plan_cycle, plan_expires_at')
      .eq('email', email)
      .maybeSingle()
    if (!prof) {
      flagSet.add('conta_nao_encontrada')
    } else {
      const status = String(prof.plan_status ?? '').trim().toLowerCase()
      if (status === 'active') {
        planoAtual = getEffectivePlan({ plan: prof.plan, plan_expires_at: prof.plan_expires_at })
        const cyc = String(prof.plan_cycle ?? '').trim().toUpperCase()
        cicloAtual = cyc === 'MONTHLY' || cyc === 'YEARLY' ? (cyc as 'MONTHLY' | 'YEARLY') : null
      } else {
        // overdue / cancelled / nulo / desconhecido → não afirmar plano ativo
        flagSet.add('status_indeterminado')
      }
    }
  }

  // 7) motivo (enum primário) — incerteza/limite têm precedência sobre upgrade/manter
  let motivo: string
  if (flagSet.has('acima_do_limite')) motivo = 'acima_do_limite'
  else if (flagSet.has('requer_analise') || flagSet.has('status_indeterminado') || flagSet.has('conta_nao_encontrada')) motivo = 'requer_analise'
  else if (!jaTemConta) motivo = 'assinar'
  else if (planoAtual && planAtLeast(planoAtual, tier)) motivo = 'manter_plano'
  else motivo = 'upgrade'

  return NextResponse.json(
    {
      ok: true,
      nome: sanitizar(a[q.nome], 60),
      jaTemConta,
      planoAtual,
      cicloAtual,
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
