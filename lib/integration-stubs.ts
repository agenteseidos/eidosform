import { log, logWarn, logError } from '@/lib/logger'
import { createPublicClient } from '@/lib/supabase/public'
import { NAME_QUESTION_KEYWORDS, firstName, capitalizeFullName } from '@/lib/name-utils'
import { formatAnswerValue, NON_ANSWER_QUESTION_TYPES } from '@/lib/answer-format'

export interface LeadFormInfo {
  id: string
  title: string | null
  user_id: string
  questions?: Array<{ id: string; title?: string; type?: string }>
}

export interface BuildLeadDataParams {
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  meta_events?: string[]
  /** Campos ocultos de identidade vindos da URL (nome/email/telefone) — mesma
   *  fonte que alimenta as colunas de identidade do Google Sheets. */
  urlParams?: Record<string, string> | null
  form: LeadFormInfo
  appUrl: string
}

/**
 * Monta o leadData (variáveis do template) a partir de uma resposta.
 * Exportado para reuso pelo cron de lead abandonado — a montagem é idêntica,
 * só muda o template. (Auditoria Codex 2026-07-23.)
 */
export function buildLeadData(params: BuildLeadDataParams): Record<string, unknown> {
  const { formId, responseId, responseData, appUrl } = params
  const urlParams = params.urlParams ?? null

  // Map question IDs to titles/types for readable data
  const questionsMap = new Map<string, string>()
  const questionTypeMap = new Map<string, string>()
  if (params.form.questions) {
    for (const q of params.form.questions) {
      if (q.id && q.title) questionsMap.set(q.id, q.title.toLowerCase().trim())
      if (q.id && q.type) questionTypeMap.set(q.id, q.type)
    }
  }

  // Build lead data by matching answer keys to question titles.
  // Formatter de domínio: objeto (arquivo/endereço/calendly) vira texto legível —
  // NUNCA "[object Object]" (o String(value) antigo quebrava {endereço} etc.).
  const mappedAnswers: Record<string, string> = {}
  for (const [key, value] of Object.entries(responseData)) {
    const label = questionsMap.get(key) || key
    mappedAnswers[label] = formatAnswerValue(value, {
      sink: 'whatsapp',
      questionType: questionTypeMap.get(key),
    })
  }

  // Bloco {respostas}: todas as perguntas respondidas, uma por bloco, na ordem
  // do FORMULÁRIO. Blocos de conteúdo (html/content) não são dados de lead.
  const respostasValue = (params.form.questions ?? [])
    .filter((q) => !NON_ANSWER_QUESTION_TYPES.has(q.type ?? ''))
    .map((q) => ({
      title: (q.title ?? '').trim(),
      answer: formatAnswerValue(responseData[q.id], { sink: 'whatsapp', questionType: q.type }),
    }))
    .filter((pair) => pair.title && pair.answer) // pergunta sem resposta é omitida
    .map((pair) => `*${pair.title}*\n${pair.answer}`) // pergunta em negrito no WhatsApp (asterisco único)
    .join('\n\n')

  // Find name, email, phone by scanning question titles.
  // Tenta match exato primeiro (evita "nome da empresa" casar com "nome");
  // só cai pro includes se nenhum título bater exatamente.
  const findByLabel = (...labels: string[]): string => {
    for (const label of labels) {
      for (const [key, val] of Object.entries(mappedAnswers)) {
        if (key === label) return val
      }
    }
    for (const label of labels) {
      for (const [key, val] of Object.entries(mappedAnswers)) {
        if (key.includes(label)) return val
      }
    }
    return ''
  }

  // Find by canonical question type — more robust than scanning titles
  const findByType = (...types: string[]): string => {
    if (!params.form.questions) return ''
    for (const t of types) {
      const q = params.form.questions.find(q => q.type === t)
      if (q && q.id && responseData[q.id] != null) {
        return String(responseData[q.id])
      }
    }
    return ''
  }

  // Identidade vinda da URL (campos ocultos de campanha) — FALLBACK quando o form
  // não pergunta nome/email/telefone. Mesmas chaves das colunas do Sheets
  // (nome/email/telefone) + variantes comuns. Sem isso, {nome}/{telefone} e o
  // {whatsapp_link} saem vazios nos forms de tráfego pago (caso RCGT0826).
  const fromUrl = (...keys: string[]): string => {
    if (!urlParams) return ''
    for (const k of keys) {
      const v = urlParams[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }

  const fullNameRaw = findByLabel(...NAME_QUESTION_KEYWORDS) || fromUrl('nome', 'name')
  const fullNameValue = fullNameRaw ? capitalizeFullName(fullNameRaw) : ''
  const firstNameValue = firstName(fullNameRaw) || 'Lead'
  const emailValue = findByType('email') || findByLabel('email', 'e-mail') || fromUrl('email', 'e-mail') || 'N/A'
  const phoneValue = findByType('phone') || findByLabel('telefone', 'phone', 'celular', 'whatsapp')
    || fromUrl('telefone', 'phone', 'celular', 'whatsapp', 'tel') || ''

  // Variáveis de data/hora — usa fuso de São Paulo pra render natural pro
  // dono brasileiro. Calculadas no momento do envio (não persistidas).
  const now = new Date()
  const sp = (parts: Intl.DateTimeFormatOptions) =>
    now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...parts })
  const horarioValue = sp({ hour: '2-digit', minute: '2-digit', hour12: false })
  const dataValue = sp({ day: '2-digit', month: '2-digit', year: 'numeric' })
  const diaSemanaValue = sp({ weekday: 'long' })

  return {
    // {nome} agora é o PRIMEIRO nome capitalizado; antes era o que o lead
    // digitou cru (caixa baixa estragava o "Oi {nome}!").
    name: firstNameValue,
    nome: firstNameValue,
    primeiro_nome: firstNameValue,
    nome_completo: fullNameValue || firstNameValue,
    email: emailValue,
    phone: phoneValue,
    telefone: phoneValue,
    celular: phoneValue,
    whatsapp: phoneValue,
    form_name: params.form.title || 'Formulário',
    response_id: responseId,
    response_link: `${appUrl}/forms/${formId}/responses?response=${responseId}`,
    horario: horarioValue,
    data: dataValue,
    dia_semana: diaSemanaValue,
    ...mappedAnswers,
    // Depois de mappedAnswers de propósito: {respostas} é placeholder
    // documentado, então ganha de uma pergunta intitulada "Respostas".
    respostas: respostasValue,
    // {meta_events}: eventos do Pixel/CAPI disparados neste preenchimento
    // (PageView, Lead, LeadQualificado...), separados por vírgula. A coluna
    // responses.meta_events já alimenta PDF e Sheets; aqui entra no WhatsApp.
    meta_events: (params.meta_events ?? []).join(', '),
  }
}

/**
 * Send WhatsApp notification when form response is submitted
 *
 * Flow:
 * 1. Calls /api/whatsapp/send internally with formId + leadData
 * 2. The send endpoint handles settings fetch, template building, and delivery
 * 3. Nunca lança — a resposta do form tem sucesso independente do WhatsApp
 */
export async function sendWhatsAppOnFormResponse(params: BuildLeadDataParams): Promise<void> {
  const { formId, responseId, appUrl } = params

  try {
    const leadData = buildLeadData(params)

    // Delegate everything to the send endpoint (settings fetch + template build + delivery)
    const sendResponse = await fetch(`${appUrl}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET || ''}`,
      },
      body: JSON.stringify({
        formId,
        leadData,
        // Idempotência fim-a-fim: a VPS deduplica reenvios do MESMO response
        // (retry do app, resubmissão autenticada) sem depender de memória.
        idempotencyKey: `form:${formId}:${responseId}`,
      }),
    })

    if (!sendResponse.ok) {
      const errorBody = await sendResponse.text()
      logWarn(`[WhatsApp] Send returned ${sendResponse.status}: ${errorBody}`)
      logWhatsAppSend(formId, responseId, 'failed', null, `HTTP ${sendResponse.status}: ${errorBody.slice(0, 300)}`).catch(() => {})
      return
    }

    const result = await sendResponse.json() as { success?: boolean; messageId?: string; error?: string; duplicate?: boolean }

    // HTTP 200 com success:false = NÃO enviado (ex.: settings.enabled=false).
    // Antes isso era registrado como 'sent' e o form_whatsapp_logs mentia
    // (achado da auditoria Codex 2026-07-23).
    if (!result.success) {
      log('[WhatsApp] Skipped', { formId, responseId, reason: result.error ?? 'unknown' })
      logWhatsAppSend(formId, responseId, 'skipped', null, result.error ?? null, String(leadData.phone ?? '')).catch(() => {})
      return
    }

    log('[WhatsApp] Sent', { formId, responseId, msgId: result.messageId ?? null, duplicate: result.duplicate ?? false })
    logWhatsAppSend(formId, responseId, 'sent', result.messageId || null, null, String(leadData.phone ?? '')).catch(() => {})
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError(`[WhatsApp] Error for form ${formId}: ${errMsg}`)

    // Log failure to form_whatsapp_logs table
    logWhatsAppSend(formId, responseId, 'failed', null, errMsg).catch(() => {})
    // Never throw — form response must succeed regardless
  }
}

/**
 * Persist WhatsApp send log to form_whatsapp_logs table (fire-and-forget).
 * `status` é texto no banco: sent | failed | skipped | abandoned_alert.
 * 'abandoned_alert' também serve de DEDUP pro cron de lead abandonado.
 */
export async function logWhatsAppSend(
  formId: string,
  responseId: string,
  status: 'sent' | 'failed' | 'skipped' | 'abandoned_alert',
  messageId: string | null,
  errorMessage: string | null,
  phoneNumber?: string
) {
  try {
    const supabase = createPublicClient()
    await (supabase as unknown as { from: (t: string) => { insert: (d: Record<string, unknown>) => Promise<unknown> } }).from('form_whatsapp_logs').insert({
      form_id: formId,
      response_id: responseId,
      phone_number: phoneNumber && phoneNumber.trim().length > 0 ? phoneNumber : null,
      message_sent: '',
      status,
      wacli_message_id: messageId,
      error_message: errorMessage,
    })
  } catch {
    // Silent — logging should never break the flow
  }
}
