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
  }
  appUrl: string
}): Promise<void> {
  const { formId, responseId, responseData, appUrl } = params

  try {
    // Build lead data from response answers
    const leadData = {
      name: String(responseData.nome || responseData.name || 'Lead'),
      email: String(responseData.email || 'N/A'),
      phone: String(responseData.phone || responseData.telefone || ''),
      form_name: params.form.title || 'Formulário',
      response_id: responseId,
      response_link: `${appUrl}/form/${formId}/responses/${responseId}`,
      ...Object.fromEntries(
        Object.entries(responseData).map(([k, v]) => [k, String(v)])
      ),
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
