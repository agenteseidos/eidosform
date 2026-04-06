import { logWarn, logError } from '@/lib/logger'
import { getWhatsAppSettings } from '@/lib/whatsapp'

/**
 * Send WhatsApp notification when form response is submitted
 *
 * Flow:
 * 1. Fetches WhatsApp settings for the form
 * 2. Builds message from template with lead data
 * 3. Calls /api/whatsapp/send internally with formId + leadData
 * 4. Fire-and-forget: never blocks the form response
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
  const { formId, responseId, responseData, form, appUrl } = params

  try {
    // Early check: are WhatsApp settings enabled for this form?
    const settings = await getWhatsAppSettings(formId)
    if (!settings || !settings.enabled) {
      return // Not configured — silent skip
    }

    // Build lead data from response answers
    const leadData = {
      name: String(responseData.nome || responseData.name || 'Lead'),
      email: String(responseData.email || 'N/A'),
      phone: String(responseData.phone || responseData.telefone || ''),
      form_name: form.title || 'Formulário',
      response_id: responseId,
      response_link: `${appUrl}/form/${formId}/responses/${responseId}`,
      ...Object.fromEntries(
        Object.entries(responseData).map(([k, v]) => [k, String(v)])
      ),
    }

    // Build message from template
    let message = settings.message_template
    message = message.replace(/\{form_name\}/g, form.title || 'Formulário')
    message = message.replace(/\{nome\}/g, leadData.name)
    message = message.replace(/\{email\}/g, leadData.email)
    message = message.replace(/\{response_id\}/g, responseId)
    message = message.replace(/\{response_link\}/g, leadData.response_link)
    // Replace any remaining template vars
    message = message.replace(/\{(\w+)\}/g, (_, key: string) =>
      String(responseData[key] ?? '')
    )

    // Call the send endpoint internally
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
