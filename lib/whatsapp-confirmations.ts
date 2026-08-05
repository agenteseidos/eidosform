/**
 * lib/whatsapp-confirmations.ts — confirmações TRANSACIONAIS ao cliente via
 * WhatsApp Cloud API (número oficial da Elen).
 *
 * Decisão Sidney 2026-07-30: o cliente recebe confirmação das próprias ações
 * (cadastro, compra, troca de plano, cancelamento, ajuste de acesso). NÃO é
 * sino pro admin. Templates UTILITY na WABA do EidosForm (regra dura de 22/07:
 * MARKETING é proibido — se um template flipar, reescreve, nunca envia).
 *
 * Princípios de projeto:
 *  - FIRE-AND-FORGET: nenhuma falha aqui pode quebrar a ação principal
 *    (uma compra JAMAIS falha por causa de uma mensagem). Tudo é try/catch
 *    com logError; os chamadores usam `void notifyX(...)`.
 *  - A lib BUSCA o perfil fresco (phone/full_name/plan/...) — os call sites
 *    não precisam mudar seus selects.
 *  - Sem telefone (ex.: cadastro via Google OAuth) → pula em silêncio
 *    (o e-mail continua cobrindo).
 *  - Opt-out: consulta plugável via ELEN_OPTOUT_CHECK_URL (serviço da VPS).
 *    Sem a env configurada, ou com o serviço fora, FAIL-OPEN (envia): são
 *    mensagens transacionais da própria conta do cliente, não campanha.
 *  - Idempotência vem do CHAMADOR: os ganchos ficam nos mesmos pontos dos
 *    e-mails existentes, que já são deduplicados (claimActivationEffects no
 *    webhook etc.). O de cadastro deduplica por flag em user_metadata.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { emitirEventoElen, type ElenEventoTipo } from '@/lib/elen-eventos'
import { toWhatsAppDigits } from '@/lib/phone'
import { log, logError, logWarn } from '@/lib/logger'

// _v2 = versões com botão de URL (4× "Acessar minha conta"→/login; cancelada:
// "Gerenciar assinatura"→/billing). APROVADAS na Meta em 08/2026; contagem de
// params conferida contra a Graph API (1/3/4/3/3) antes da troca. Botão é URL
// ESTÁTICA — não entra parâmetro de botão no envio. Os v1 (sem botão) foram
// arquivados; NUNCA reintroduzir fallback automático v1/v2 (risco de mensagem
// duplicada se a Meta aceitar e a resposta se perder — ordem Codex 2026-07-30).
export const CONFIRMATION_TEMPLATES = {
  cadastroConfirmado: 'eidosform_cadastro_confirmado_v2',
  planoAtivado: 'eidosform_plano_ativado_v2',
  planoAlterado: 'eidosform_plano_alterado_v2',
  assinaturaCancelada: 'eidosform_assinatura_cancelada_v2',
  acessoAtualizado: 'eidosform_acesso_atualizado_v2',
} as const

const PLAN_PT: Record<string, string> = {
  free: 'Gratuito',
  starter: 'Starter',
  plus: 'Plus',
  professional: 'Professional',
}

/** "Starter Mensal" / "Plus Anual" / "Plus" (grant manual, sem ciclo). */
export function planLabel(plan?: string | null, cycle?: string | null): string {
  const base = PLAN_PT[String(plan ?? '').toLowerCase()] ?? String(plan ?? 'seu plano')
  if (cycle === 'MONTHLY') return `${base} Mensal`
  if (cycle === 'YEARLY') return `${base} Anual`
  return base
}

/** DD/MM/AAAA em horário de Brasília a partir de um ISO. */
export function brDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' })
}

function cloudCreds(): { token: string; phoneId: string } | null {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const phoneId = process.env.WHATSAPP_CLOUD_PHONE_ID
  if (!token || !phoneId) return null
  return { token, phoneId }
}

/** Consulta de opt-out plugável (serviço da Elen na VPS). Fail-open com log. */
async function isOptedOut(phoneDigits: string): Promise<boolean> {
  const url = process.env.ELEN_OPTOUT_CHECK_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!url || !secret) return false
  try {
    const res = await fetch(`${url}?phone=${encodeURIComponent(phoneDigits)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return false
    const json = await res.json().catch(() => null) as { optedOut?: boolean } | null
    return json?.optedOut === true
  } catch (err) {
    logWarn('[wpp-confirm] Consulta de opt-out falhou — fail-open (transacional)', { err: String(err) })
    return false
  }
}

/**
 * Envia um template de confirmação. Nunca lança. Retorna o resultado para
 * quem quiser registrar (ex.: journal do admin), mas pode ser ignorado.
 */
const TEMPLATE_EVENTO: Record<string, ElenEventoTipo> = {
  [CONFIRMATION_TEMPLATES.cadastroConfirmado]: 'cadastro',
  [CONFIRMATION_TEMPLATES.planoAtivado]: 'ativado',
  [CONFIRMATION_TEMPLATES.planoAlterado]: 'alterado',
  [CONFIRMATION_TEMPLATES.assinaturaCancelada]: 'cancelado',
  [CONFIRMATION_TEMPLATES.acessoAtualizado]: 'acesso',
}

export async function sendConfirmationTemplate(params: {
  toPhone: string | null | undefined
  template: string
  bodyParams: string[]
  context: string
  /** Rótulo curto pro evento da Elen (ex.: "Plus Mensal", "Starter → Plus"). */
  eventoDetalhe?: string
}): Promise<{ sent: boolean; skipped?: string }> {
  try {
    const creds = cloudCreds()
    if (!creds) {
      logWarn('[wpp-confirm] WHATSAPP_CLOUD_TOKEN/PHONE_ID ausentes — confirmação NÃO enviada', { context: params.context })
      return { sent: false, skipped: 'no_credentials' }
    }
    const digits = toWhatsAppDigits(params.toPhone ?? '')
    if (!digits) return { sent: false, skipped: 'no_phone' }
    if (await isOptedOut(digits)) {
      log('[wpp-confirm] Destinatário em opt-out — confirmação suprimida', { context: params.context })
      return { sent: false, skipped: 'opted_out' }
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'template',
        template: {
          name: params.template,
          language: { code: 'pt_BR' },
          components: [{
            type: 'body',
            parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
          }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    })
    const json = await res.json().catch(() => null) as
      | { messages?: { id: string }[]; error?: { message?: string; code?: number } }
      | null
    if (!res.ok || !json?.messages?.[0]?.id) {
      // Template ainda PENDING na Meta cai aqui — log alto, sem quebrar nada.
      logError('[wpp-confirm] Envio de confirmação falhou', json?.error ?? `HTTP ${res.status}`, {
        context: params.context, template: params.template,
      })
      return { sent: false, skipped: 'send_failed' }
    }
    const wamid = json.messages[0].id
    log('[wpp-confirm] Confirmação enviada', { context: params.context, template: params.template, wamid })
    // Pacote B (mesa 2026-08-03): avisa a Elen NO ATO — ficha invalidada + memória
    // do evento. O WAMID (antes descartado) vira a chave de idempotência. Roda no
    // MESMO contexto pós-resposta do chamador; falha nunca afeta a confirmação.
    const evento = TEMPLATE_EVENTO[params.template]
    if (evento) {
      await emitirEventoElen({ evento, telefone: params.toPhone, wamid, detalhe: params.eventoDetalhe ?? null })
        .catch((err) => logWarn('[wpp-confirm] emitirEventoElen lançou (não bloqueante)', { err: String(err).slice(0, 120) }))
    }
    return { sent: true }
  } catch (err) {
    logError('[wpp-confirm] Exceção no envio de confirmação (não bloqueante)', err, { context: params.context })
    return { sent: false, skipped: 'exception' }
  }
}

type ProfileLite = {
  phone: string | null
  full_name: string | null
  plan: string | null
  plan_cycle: string | null
  plan_expires_at: string | null
}

async function fetchProfile(profileId: string): Promise<ProfileLite | null> {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('profiles')
      .select('phone, full_name, plan, plan_cycle, plan_expires_at')
      .eq('id', profileId)
      .single<ProfileLite>()
    return data ?? null
  } catch {
    return null
  }
}

// Conta com nome INSTITUCIONAL (ex.: "Instituto Eidos") não pode virar
// "Olá, Instituto!" (teste real 05/08). Heurística conservadora: palavra
// inicial tipicamente empresarial → saudação neutra. Falso negativo =
// comportamento antigo (chama pelo 1º nome); falso positivo = "Olá, tudo bem".
const INSTITUTIONAL_RE = /^(instituto|agencia|agência|clinica|clínica|consultorio|consultório|escritorio|escritório|studio|estudio|estúdio|grupo|centro|empresa|comercio|comércio|servicos|serviços|associacao|associação|fundacao|fundação|igreja|colegio|colégio|escola|faculdade|universidade|hospital|farmacia|farmácia|loja|restaurante|hotel|pousada|academia|oficina|imobiliaria|imobiliária|construtora|transportadora|distribuidora|editora|produtora|holding|ltda|eireli|mei)$/i

export function firstName(fullName?: string | null): string {
  const first = String(fullName ?? '').trim().split(/\s+/)[0]
  if (!first || INSTITUTIONAL_RE.test(first)) return 'tudo bem'
  return first
}

/** Cadastro concluído (e-mail confirmado). Dedupe é do chamador (flag em user_metadata). */
export async function notifyCadastroConfirmado(profileId: string): Promise<{ sent: boolean; skipped?: string }> {
  const p = await fetchProfile(profileId)
  if (!p) return { sent: false, skipped: 'no_profile' }
  return sendConfirmationTemplate({
    toPhone: p.phone,
    template: CONFIRMATION_TEMPLATES.cadastroConfirmado,
    bodyParams: [firstName(p.full_name)],
    context: `cadastro:${profileId}`,
  })
}

/** Plano ativado (pagamento confirmado). chargeInfo ex.: "30/08/2026" ou texto de cortesia. */
export async function notifyPlanoAtivado(profileId: string, opts?: { chargeInfo?: string }): Promise<{ sent: boolean; skipped?: string }> {
  const p = await fetchProfile(profileId)
  if (!p) return { sent: false, skipped: 'no_profile' }
  const charge = opts?.chargeInfo ?? brDate(p.plan_expires_at) ?? 'a confirmar'
  return sendConfirmationTemplate({
    toPhone: p.phone,
    template: CONFIRMATION_TEMPLATES.planoAtivado,
    bodyParams: [firstName(p.full_name), planLabel(p.plan, p.plan_cycle), charge],
    context: `ativado:${profileId}`,
    eventoDetalhe: planLabel(p.plan, p.plan_cycle),
  })
}

/** Troca de plano (upgrade/downgrade). Rótulos do estado ANTERIOR vêm do chamador. */
export async function notifyPlanoAlterado(profileId: string, opts: { fromLabel: string; chargeInfo?: string }): Promise<{ sent: boolean; skipped?: string }> {
  const p = await fetchProfile(profileId)
  if (!p) return { sent: false, skipped: 'no_profile' }
  const charge = opts.chargeInfo ?? brDate(p.plan_expires_at) ?? 'a confirmar'
  return sendConfirmationTemplate({
    toPhone: p.phone,
    template: CONFIRMATION_TEMPLATES.planoAlterado,
    bodyParams: [firstName(p.full_name), opts.fromLabel, planLabel(p.plan, p.plan_cycle), charge],
    context: `alterado:${profileId}`,
    eventoDetalhe: `${opts.fromLabel} → ${planLabel(p.plan, p.plan_cycle)}`,
  })
}

/** Cancelamento. accessUntil default = plan_expires_at do perfil. */
export async function notifyAssinaturaCancelada(profileId: string, opts: { planLabel: string; accessUntil?: string }): Promise<{ sent: boolean; skipped?: string }> {
  const p = await fetchProfile(profileId)
  if (!p) return { sent: false, skipped: 'no_profile' }
  const until = opts.accessUntil ?? brDate(p.plan_expires_at) ?? 'o fim do período pago'
  return sendConfirmationTemplate({
    toPhone: p.phone,
    template: CONFIRMATION_TEMPLATES.assinaturaCancelada,
    bodyParams: [firstName(p.full_name), opts.planLabel, until],
    context: `cancelada:${profileId}`,
    eventoDetalhe: `${opts.planLabel} — acesso até ${until}`,
  })
}

/** Ajuste de data de acesso (o "+15 dias" do admin). */
export async function notifyAcessoAtualizado(profileId: string, opts?: { validUntil?: string }): Promise<{ sent: boolean; skipped?: string }> {
  const p = await fetchProfile(profileId)
  if (!p) return { sent: false, skipped: 'no_profile' }
  const until = opts?.validUntil ?? brDate(p.plan_expires_at) ?? 'a data informada'
  return sendConfirmationTemplate({
    toPhone: p.phone,
    template: CONFIRMATION_TEMPLATES.acessoAtualizado,
    bodyParams: [firstName(p.full_name), planLabel(p.plan, p.plan_cycle), until],
    context: `acesso:${profileId}`,
    eventoDetalhe: `${planLabel(p.plan, p.plan_cycle)} até ${until}`,
  })
}
