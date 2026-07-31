/**
 * lib/notification-model.ts — MODELO NEUTRO de notificação de lead.
 *
 * Uma resposta de formulário (completa ou abandonada) descrita de um jeito que
 * NENHUM canal reconhece como seu: sem Markdown de WhatsApp, sem HTML, sem
 * Supabase, sem logging, sem I/O. Cada canal adapta a partir daqui:
 *   - WhatsApp → lib/integration-stubs.ts (buildLeadData) → lib/whatsapp-template.ts
 *   - E-mail   → lib/notification-content.ts
 *
 * Por que existe (plano docs/plano-notificacao-email.md §3.2): a montagem antiga
 * vivia dentro do adaptador de WhatsApp e já entregava `*pergunta*` em Markdown.
 * Consumir aquilo no e-mail mandaria asteriscos literais pro cliente.
 *
 * REGRA DE OURO: nada aqui pode chamar `new Date()`. O horário do evento é o
 * PERSISTIDO (`responses.submitted_at` na resposta completa, `last_activity_at`
 * no abandono) e entra pronto por `eventAt` — senão uma retentativa mostraria a
 * hora do aviso como se fosse a hora do lead (§3.3).
 */

import { NAME_QUESTION_KEYWORDS, firstName, capitalizeFullName } from './name-utils'
import { formatAnswerValue, NON_ANSWER_QUESTION_TYPES } from './answer-format'

export interface NotificationFormInfo {
  id: string
  title: string | null
  user_id: string
  questions?: Array<{ id: string; title?: string; type?: string }>
}

export interface NotificationAnswer {
  /** Título da pergunta, como o dono escreveu. Vem do usuário: ESCAPE no HTML. */
  question: string
  /**
   * Rendição NEUTRA do valor (sem emoji de canal, sem Markdown) — pronta para
   * ser exibida como texto. Vem do lead: ESCAPE no HTML.
   */
  value: string
  /** Tipo canônico da pergunta (lib/questions.ts), quando conhecido. */
  questionType?: string
  /**
   * Valor CRU persistido. Existe para o canal que quer sua própria formatação
   * (o WhatsApp reformata com `sink: 'whatsapp'` para manter emoji e multilinha).
   * ⚠️ NUNCA jogue isto num corpo de mensagem direto: passe por
   * `formatAnswerValue` e, no e-mail, por `escapeHtml`.
   */
  rawValue: unknown
}

export interface NotificationModel {
  form: { id: string; title: string; userId: string }
  response: {
    id: string
    link: string
    /** Horário PERSISTIDO do evento, ISO. Nunca new Date(). */
    eventAt: string
  }
  identity: {
    /** Primeiro nome capitalizado; 'Lead' quando não há nome. */
    firstName: string
    /** Nome completo capitalizado, quando existe. */
    fullName?: string
    email?: string
    phone?: string
  }
  /** Respostas como pares, na ordem do FORMULÁRIO, SEM formatação de canal. */
  answers: NotificationAnswer[]
  utm: {
    source?: string
    medium?: string
    campaign?: string
    term?: string
    content?: string
  }
  /**
   * Nomes de evento registrados NA RESPOSTA (responses.meta_events).
   * NÃO é confirmação de entrega a nenhuma plataforma de anúncios — quem
   * apresenta isto ao cliente tem que dizer "registrados", nunca "entregues"
   * (decisão 6 do plano).
   */
  conversionEvents: string[]
  /** Minutos sem atividade — só no evento de abandono (Entrega 2). */
  inactiveMinutes?: number
}

export interface BuildNotificationModelParams {
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  form: NotificationFormInfo
  appUrl: string
  /** Horário PERSISTIDO do evento (ISO). Obrigatório — ver regra de ouro acima. */
  eventAt: string
  metaEvents?: string[]
  /** Campos ocultos de identidade vindos da URL (nome/email/telefone). */
  urlParams?: Record<string, string> | null
  utm?: Record<string, string | null> | null
  inactiveMinutes?: number
}

/** Rendição neutra de um valor de resposta: linha única quando possível, sem emoji. */
function neutralValue(raw: unknown, questionType?: string): string {
  return formatAnswerValue(raw, { sink: 'export', questionType })
}

export function buildNotificationModel(params: BuildNotificationModelParams): NotificationModel {
  const { formId, responseId, responseData, form, appUrl, eventAt } = params
  const urlParams = params.urlParams ?? null
  const questions = form.questions ?? []

  // Mapa título(minúsculo) → valor, usado SÓ para resolver identidade por rótulo.
  // Inclui respostas órfãs (chave sem pergunta correspondente), como antes.
  const questionTitleById = new Map<string, string>()
  const questionTypeById = new Map<string, string>()
  for (const q of questions) {
    if (q.id && q.title) questionTitleById.set(q.id, q.title.toLowerCase().trim())
    if (q.id && q.type) questionTypeById.set(q.id, q.type)
  }
  const byLabel: Record<string, string> = {}
  for (const [key, value] of Object.entries(responseData)) {
    const label = questionTitleById.get(key) || key
    byLabel[label] = neutralValue(value, questionTypeById.get(key))
  }

  // Pares pergunta/resposta na ordem do formulário. Blocos de conteúdo
  // (html/content) não são dados de lead. NÃO filtramos por valor vazio aqui:
  // cada canal filtra pela SUA rendição, porque o que é vazio num pode não ser
  // no outro (um anexo sem nome vira "📎 " no WhatsApp e "" no neutro).
  const answers: NotificationAnswer[] = questions
    .filter((q) => !NON_ANSWER_QUESTION_TYPES.has(q.type ?? ''))
    .map((q) => ({
      question: (q.title ?? '').trim(),
      questionType: q.type,
      rawValue: responseData[q.id],
      value: neutralValue(responseData[q.id], q.type),
    }))
    .filter((a) => a.question)

  // ── Identidade ───────────────────────────────────────────────────────────
  // Prioridade por campo: (1) tipo canônico da pergunta → (2) título EXATO →
  // (3) parâmetro da URL (identidade da campanha) → (4) título DIFUSO.
  // A difusa é perigosa ("telefone da empresa" casa "telefone"), por isso os
  // url_params entram ANTES dela — bug real pego em 23/07.
  const findByLabelExact = (...labels: string[]): string => {
    for (const label of labels) {
      for (const [key, val] of Object.entries(byLabel)) {
        if (key === label && val) return val
      }
    }
    return ''
  }
  const findByLabelFuzzy = (...labels: string[]): string => {
    for (const label of labels) {
      for (const [key, val] of Object.entries(byLabel)) {
        if (key.includes(label) && val) return val
      }
    }
    return ''
  }
  // Percorre TODAS as perguntas do tipo e devolve a primeira NÃO vazia (P2-4:
  // com `.find()`, um form com dois campos `phone` perdia o telefone real
  // quando o primeiro vinha em branco).
  const findByType = (...types: string[]): string => {
    for (const t of types) {
      for (const q of questions) {
        if (q.type !== t || !q.id) continue
        const raw = responseData[q.id]
        if (raw == null) continue
        const value = String(raw).trim()
        if (value) return value
      }
    }
    return ''
  }
  const fromUrl = (...keys: string[]): string => {
    if (!urlParams) return ''
    for (const k of keys) {
      const v = urlParams[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }

  const nameKw = [...NAME_QUESTION_KEYWORDS]
  const fullNameRaw = findByLabelExact(...nameKw) || fromUrl('nome', 'name') || findByLabelFuzzy(...nameKw)
  const emailRaw = findByType('email') || findByLabelExact('email', 'e-mail')
    || fromUrl('email', 'e-mail') || findByLabelFuzzy('email', 'e-mail')
  const phoneRaw = findByType('phone') || findByLabelExact('telefone', 'phone', 'celular', 'whatsapp')
    || fromUrl('telefone', 'phone', 'celular', 'whatsapp', 'tel')
    || findByLabelFuzzy('telefone', 'phone', 'celular', 'whatsapp')

  const fullName = fullNameRaw ? capitalizeFullName(fullNameRaw) : ''

  return {
    form: {
      id: formId,
      title: form.title || 'Formulário',
      userId: form.user_id,
    },
    response: {
      id: responseId,
      link: `${appUrl}/forms/${formId}/responses?response=${responseId}`,
      eventAt,
    },
    identity: {
      firstName: firstName(fullNameRaw) || 'Lead',
      ...(fullName ? { fullName } : {}),
      ...(emailRaw ? { email: emailRaw } : {}),
      ...(phoneRaw ? { phone: phoneRaw } : {}),
    },
    answers,
    utm: {
      ...(params.utm?.utm_source ? { source: params.utm.utm_source } : {}),
      ...(params.utm?.utm_medium ? { medium: params.utm.utm_medium } : {}),
      ...(params.utm?.utm_campaign ? { campaign: params.utm.utm_campaign } : {}),
      ...(params.utm?.utm_term ? { term: params.utm.utm_term } : {}),
      ...(params.utm?.utm_content ? { content: params.utm.utm_content } : {}),
    },
    conversionEvents: (params.metaEvents ?? []).filter(
      (e): e is string => typeof e === 'string' && e.trim().length > 0
    ),
    ...(params.inactiveMinutes !== undefined ? { inactiveMinutes: params.inactiveMinutes } : {}),
  }
}
