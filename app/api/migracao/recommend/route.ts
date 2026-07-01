import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { type PlanId } from '@/lib/plans'
import { MIGRACAO, validarContratoForm } from '@/lib/migracao/config'
import { recomendarPlano, normalizarTelefoneBR, normalizarEmail } from '@/lib/migracao/regua'
import { resolverPlanoAtual, aplicarPisoMigracao, decidirMotivo } from '@/lib/migracao/decisao'
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

// Pedido de migração não localizado pelo número (a pessoa não preencheu o form / número diferente).
const naoConfirmado = () =>
  NextResponse.json({ ok: false, reason: 'nao_confirmado' }, { status: 200, headers: NO_STORE })

/**
 * POST /api/migracao/recommend  — INTERNO (Bearer INTERNAL_API_SECRET).
 * Body: { phone, email }  (phone = telefone real do remetente; email = confirmado na conversa).
 *
 * Mecânica: acha o PEDIDO de migração pelo NÚMERO do remetente (o form que a pessoa preencheu do
 * próprio celular) → tira o USO dali; e cruza o E-MAIL com os clientes p/ achar a CONTA/plano atual
 * (o e-mail pode ser corrigido no chat sem quebrar a localização do pedido).
 *
 * ⚠️ RISCO ACEITO (Sidney, 2026-07-01): a consulta de plano por e-mail NÃO verifica posse do e-mail
 * (não há OTP). Alguém que saiba o e-mail de um cliente pode ver o TIER + CICLO do plano dele. Decisão
 * consciente (só leitura; dado de baixa sensibilidade). NÃO tratar isto como bug/vazamento em auditoria.
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

  // 5) acha o PEDIDO pelo NÚMERO do remetente. O e-mail NÃO entra na busca — assim a pessoa pode
  //    CORRIGIR o e-mail no chat sem perder a localização do pedido.
  const q = MIGRACAO.q
  const answersDe = (r: { answers?: unknown }) => (r.answers ?? {}) as Record<string, unknown>
  const emailDoForm = (r: { answers?: unknown }) => {
    const ans = answersDe(r)
    return normalizarEmail(ans[q.emailSim] ?? ans[q.emailNao] ?? '')
  }
  // rows já vem ordenado por submitted_at DESC → o [0] de cada recorte é o mais recente.
  const doTelefone = (rows ?? []).filter((r) => normalizarTelefoneBR(answersDe(r)[q.telefone]) === phone)
  if (doTelefone.length === 0) return naoConfirmado()

  // Desambiguação anti-mistura (número compartilhado/reciclado / duas submissões): escolhe pela
  // IDENTIDADE — a submissão cujo e-mail do form casa com o e-mail confirmado no chat. Sem casar:
  // 1 identidade (ou correção de e-mail) → mais recente; identidades DIVERGENTES → não arrisca
  // cruzar o uso de A com a conta de B → manda pro humano (sem expor uso/plano).
  let match = doTelefone[0]
  if (doTelefone.length > 1) {
    const porEmail = doTelefone.filter((r) => emailDoForm(r) === email)
    if (porEmail.length >= 1) {
      match = porEmail[0]
    } else {
      const emailsDistintos = new Set(doTelefone.map(emailDoForm).filter(Boolean))
      if (emailsDistintos.size > 1) {
        console.warn('[migracao] múltiplas submissões divergentes pro mesmo telefone → requer_analise')
        return NextResponse.json(
          { ok: true, motivo: 'requer_analise', flags: ['submissao_ambigua'] },
          { status: 200, headers: NO_STORE }
        )
      }
    }
  }

  const a = answersDe(match)
  const jaTemConta = String(a[q.jaConta] ?? '').trim().toLowerCase() === 'sim'

  const usage = {
    respostasMes: a[q.respostasMes],
    maiorForm: a[q.maiorForm],
    qtdForms: a[q.qtdForms],
    recursos: a[q.recursos],
  }
  const { tier: tierUso, flags } = recomendarPlano(usage)
  // Piso comercial: migração feita pela equipe é benefício PAGO → recomendação nunca abaixo de Starter.
  const tier = aplicarPisoMigracao(tierUso)
  // Sinaliza p/ a Elen a copy "seu volume cabe no Grátis, mas a migração feita por nós começa no Starter".
  const usoCabeGratis = tierUso === 'free'
  const flagSet = new Set(flags)

  // 6) CONTA/PLANO — cruza o E-MAIL com os clientes da plataforma (ver aviso de RISCO ACEITO no topo).
  let planoAtual: PlanId | null = null
  let cicloAtual: 'MONTHLY' | 'YEARLY' | null = null
  let contaNaoEncontrada = false
  {
    const { data: prof, error: profErr } = await sb
      .from('profiles')
      .select('plan, plan_status, plan_cycle, plan_expires_at')
      .eq('email', email)
      .maybeSingle()
    if (profErr) {
      // PGRST116 = maybeSingle achou MAIS de uma linha (e-mail duplicado; profiles.email não é
      // unique) → fail-closed p/ humano. Qualquer OUTRO erro é transitório (DB/rede) → 500 p/ o
      // bot RETENTAR — não vira "requer_analise" comercial de um problema técnico.
      if ((profErr as { code?: string }).code === 'PGRST116') {
        console.warn('[migracao] e-mail duplicado em profiles → requer_analise')
        flagSet.add('requer_analise')
      } else {
        console.error('[migracao] lookup de profile falhou (transitório):', profErr.message)
        return NextResponse.json({ ok: false, reason: 'erro' }, { status: 500, headers: NO_STORE })
      }
    } else if (!prof) {
      contaNaoEncontrada = true
    } else {
      const res = resolverPlanoAtual(prof)
      if (res.indeterminado) flagSet.add('requer_analise')
      else {
        planoAtual = res.plano
        cicloAtual = res.ciclo
      }
    }
  }

  // 7) motivo (enum) — matriz pura e testável (lib/migracao/decisao.ts).
  const motivo = decidirMotivo({ flags: flagSet, contaNaoEncontrada, jaTemConta, planoAtual, tier })

  return NextResponse.json(
    {
      ok: true,
      nome: sanitizar(a[q.nome], 60),
      jaTemConta,
      usoCabeGratis,
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
