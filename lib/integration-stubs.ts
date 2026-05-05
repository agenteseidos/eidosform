import { log, logWarn, logError } from '@/lib/logger'
import { createPublicClient } from '@/lib/supabase/public'

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
    // Build lead data from response answers — same format as the working version from April 8
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
