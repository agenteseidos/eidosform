import { logWarn } from '@/lib/logger'

export async function sendWhatsAppNotificationStub(params: {
  formId: string
  responseId: string
  phoneNumber: string
}) {
  logWarn('[responses] WhatsApp notification not implemented on backend')
}

export async function syncGoogleSheetsStub(params: {
  formId: string
  responseId: string
  googleSheetsId: string
}) {
  logWarn('[responses] Google Sheets sync not implemented on backend')
}
