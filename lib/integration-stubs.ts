import { log, logWarn, logError } from '@/lib/logger'
import { createPublicClient } from '@/lib/supabase/public'
import { NAME_QUESTION_KEYWORDS, firstName, capitalizeFullName } from '@/lib/name-utils'

/**
 * Send WhatsApp notification when form response is submitted
 *
 * Flow:
 * 1. Calls /api/whatsapp/send internally with formId + leadData
 * 2. The send endpoint handles settings fetch, template building, and delivery
 * 3. Fire-and-forget: never blocks the form response
 */
export async function sendWhatsAppOnFormResponse(params: {
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  meta_events?: string[]
  form: {
    id: string
    title: string | null
    user_id: string
    questions?: Array<{ id: string; title?: string; type?: string }>
  }
  appUrl: string
}): Promise<void> {
  const { formId, responseId, responseData, appUrl } = params

  try {
    // Map question IDs to titles for readable data
    const questionsMap = new Map<string, string>()
    if (params.form.questions) {
      for (const q of params.form.questions) {
        if (q.id && q.title) questionsMap.set(q.id, q.title.toLowerCase().trim())
      }
    }

    // Build lead data by matching answer keys to question titles
    const mappedAnswers: Record<string, string> = {}
    for (const [key, value] of Object.entries(responseData)) {
      const label = questionsMap.get(key) || key
      mappedAnswers[label] = String(value ?? '')
    }

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

    const fullNameRaw = findByLabel(...NAME_QUESTION_KEYWORDS)
    const fullNameValue = fullNameRaw ? capitalizeFullName(fullNameRaw) : ''
    const firstNameValue = firstName(fullNameRaw) || 'Lead'
    const emailValue = findByType('email') || findByLabel('email', 'e-mail') || 'N/A'
    const phoneValue = findByType('phone') || findByLabel('telefone', 'phone', 'celular', 'whatsapp') || ''

    // Variáveis de data/hora — usa fuso de São Paulo pra render natural pro
    // dono brasileiro. Calculadas no momento do envio (não persistidas).
    const now = new Date()
    const sp = (parts: Intl.DateTimeFormatOptions) =>
      now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...parts })
    const horarioValue = sp({ hour: '2-digit', minute: '2-digit', hour12: false })
    const dataValue = sp({ day: '2-digit', month: '2-digit', year: 'numeric' })
    const diaSemanaValue = sp({ weekday: 'long' })

    const leadData = {
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
      response_link: `${appUrl}/form/${formId}/responses/${responseId}`,
      horario: horarioValue,
      data: dataValue,
      dia_semana: diaSemanaValue,
      ...mappedAnswers,
    }

    // Delegate everything to the send endpoint (settings fetch + template build + delivery)
    const sendResponse = await fetch(`${appUrl}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET || ''}`,
      },
      body: JSON.stringify({ formId, leadData }),
    })

    if (!sendResponse.ok) {
      const errorBody = await sendResponse.text()
      logWarn(`[WhatsApp] Send returned ${sendResponse.status}: ${errorBody}`)
      return
    }

    const result = await sendResponse.json() as { success?: boolean; messageId?: string }
    log('[WhatsApp] Sent', { formId, responseId, msgId: result.messageId ?? null })

    // Log to form_whatsapp_logs table for auditing
    logWhatsAppSend(formId, responseId, 'sent', result.messageId || null, null, leadData.phone).catch(() => {})
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError(`[WhatsApp] Error for form ${formId}: ${errMsg}`)

    // Log failure to form_whatsapp_logs table
    logWhatsAppSend(formId, responseId, 'failed', null, errMsg).catch(() => {})
    // Never throw — form response must succeed regardless
  }
}

/**
 * Persist WhatsApp send log to form_whatsapp_logs table (fire-and-forget)
 */
async function logWhatsAppSend(
  formId: string,
  responseId: string,
  status: 'sent' | 'failed',
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
