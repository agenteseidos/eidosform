import { logWarn, logError } from '@/lib/logger'
import { getWhatsAppSettings } from '@/lib/whatsapp'

// Deprecated stubs — use real implementations below
// export async function sendWhatsAppNotificationStub(params: {
//   formId: string
//   responseId: string
//   phoneNumber: string
// }) {
//   logWarn('[responses] WhatsApp notification not implemented on backend')
// }

// export async function syncGoogleSheetsStub(params: {
//   formId: string
//   responseId: string
//   googleSheetsId: string
// }) {
//   logWarn('[responses] Google Sheets sync not implemented on backend')
// }

/**
 * Send WhatsApp notification when form response is submitted
 * 
 * This function:
 * 1. Fetches form details and WhatsApp settings
 * 2. Builds message by replacing template variables
 * 3. Calls /api/whatsapp/send to send via wacli
 * 4. Logs result for auditing
 * 
 * @param formId - Form ID that received the response
 * @param responseId - Response ID to include in message
 * @param responseData - Answer data from response (answers object)
 * @param responseEmail - Email field from response (if available)
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
    // 1. Get WhatsApp settings for this form
    const settings = await getWhatsAppSettings(formId)
    
    if (!settings || !settings.enabled) {
      logWarn(`[WhatsApp] Settings not enabled for form ${formId}`)
      return
    }

    // 2. Build message by replacing template variables
    let message = settings.message_template

    // Replace {form_name}
    message = message.replace('{form_name}', form.title || 'Formulário')

    // Replace response-specific variables from answers
    // Extract nome, email, and other fields from responseData
    const extractedName = responseData.nome || responseData.name || 'Lead'
    const extractedEmail = responseData.email || 'N/A'
    
    message = message.replace('{nome}', String(extractedName))
    message = message.replace('{email}', String(extractedEmail))
    message = message.replace('{response_id}', responseId)
    
    // Add link to view response if appUrl provided
    const responseLink = `${appUrl}/form/${formId}/responses/${responseId}`
    message = message.replace('{response_link}', responseLink)

    // 3. Call /api/whatsapp/send
    const whatsappResponse = await fetch(
      `${appUrl}/api/whatsapp/send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({
          instance: settings.instance_name,
          to: settings.owner_phone,
          message,
        }),
      }
    )

    if (!whatsappResponse.ok) {
      const errorText = await whatsappResponse.text()
      logError(
        `[WhatsApp] Failed to send notification for form ${formId}: ${whatsappResponse.status} ${errorText}`
      )
      // Don't throw — let form response succeed even if WhatsApp fails
      return
    }

    const result = await whatsappResponse.json() as { success?: boolean; messageId?: string }
    
    // 4. Log success
    logWarn(`[WhatsApp] Notification sent for form ${formId}, response ${responseId}, messageId: ${result.messageId || 'unknown'}`)
  } catch (error) {
    logError(`[WhatsApp] Error sending notification: ${error instanceof Error ? error.message : String(error)}`)
    // Silently fail — don't block form response
  }
}
