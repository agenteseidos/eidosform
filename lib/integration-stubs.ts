import { logWarn, logError } from '@/lib/logger'

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

    // Find name, email, phone by scanning question titles
    const findByLabel = (...labels: string[]): string => {
      for (const label of labels) {
        for (const [key, val] of Object.entries(mappedAnswers)) {
          if (key.includes(label)) return val
        }
      }
      return ''
    }

    const leadData = {
      name: findByLabel('nome', 'name', 'nome completo') || 'Lead',
      email: findByLabel('email', 'e-mail') || 'N/A',
      phone: findByLabel('telefone', 'phone', 'celular', 'whatsapp') || '',
      form_name: params.form.title || 'Formulário',
      response_id: responseId,
      response_link: `${appUrl}/form/${formId}/responses/${responseId}`,
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
    logWarn(`[WhatsApp] ✅ Sent for form ${formId}, response ${responseId}, msgId: ${result.messageId || 'N/A'}`)
  } catch (error) {
    logError(
      `[WhatsApp] Error for form ${formId}: ${error instanceof Error ? error.message : String(error)}`
    )
    // Never throw — form response must succeed regardless
  }
}
