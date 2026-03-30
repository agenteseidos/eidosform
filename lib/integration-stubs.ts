export async function sendWhatsAppNotificationStub(params: {
  formId: string
  responseId: string
  phoneNumber: string
}) {
  console.warn('[responses] WhatsApp notification not implemented on backend — skipping', params)
}

export async function syncGoogleSheetsStub(params: {
  formId: string
  responseId: string
  googleSheetsId: string
}) {
  console.warn('[responses] Google Sheets sync not implemented on backend — skipping', params)
}
