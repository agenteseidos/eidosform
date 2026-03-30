export function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isValidNotificationEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function isValidWhatsAppNumber(value: string): boolean {
  const normalized = value.replace(/[\s\-().]/g, '')
  return /^\+?\d{10,15}$/.test(normalized)
}

export function isValidGoogleSheetsId(value: string): boolean {
  return /^[a-zA-Z0-9-_]{20,}$/.test(value)
}

export function normalizeWhatsAppNumber(value: string): string {
  return value.replace(/[\s\-().]/g, '')
}

export function validateFormIntegrations(input: {
  notify_email?: unknown
  notify_whatsapp_number?: unknown
  google_sheets_id?: unknown
}): { valid: boolean; errors: string[]; values: { notify_email?: string | null; notify_whatsapp_number?: string | null; google_sheets_id?: string | null } } {
  const errors: string[] = []
  const values: { notify_email?: string | null; notify_whatsapp_number?: string | null; google_sheets_id?: string | null } = {}

  if (input.notify_email !== undefined) {
    const email = normalizeOptionalString(input.notify_email)
    if (email === undefined) {
      errors.push('notify_email must be a string or null')
    } else if (email !== null && !isValidNotificationEmail(email)) {
      errors.push('notify_email format is invalid')
    } else {
      values.notify_email = email?.toLowerCase() ?? null
    }
  }

  if (input.notify_whatsapp_number !== undefined) {
    const whatsapp = normalizeOptionalString(input.notify_whatsapp_number)
    if (whatsapp === undefined) {
      errors.push('notify_whatsapp_number must be a string or null')
    } else if (whatsapp !== null && !isValidWhatsAppNumber(whatsapp)) {
      errors.push('notify_whatsapp_number format is invalid')
    } else {
      values.notify_whatsapp_number = whatsapp ? normalizeWhatsAppNumber(whatsapp) : null
    }
  }

  if (input.google_sheets_id !== undefined) {
    const sheetsId = normalizeOptionalString(input.google_sheets_id)
    if (sheetsId === undefined) {
      errors.push('google_sheets_id must be a string or null')
    } else if (sheetsId !== null && !isValidGoogleSheetsId(sheetsId)) {
      errors.push('google_sheets_id format is invalid')
    } else {
      values.google_sheets_id = sheetsId
    }
  }

  return { valid: errors.length === 0, errors, values }
}
