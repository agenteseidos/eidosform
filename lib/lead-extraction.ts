/**
 * lib/lead-extraction.ts — Extract canonical lead fields from form response.
 * Used by webhook-dispatcher and integration-stubs (WhatsApp).
 * Hybrid lookup: question type first (deterministic), title fallback.
 */

export interface ExtractedLead {
  name: string
  email: string
  phone: string
}

export function extractLead(params: {
  responseData: Record<string, unknown>
  questions?: Array<{ id: string; title?: string; type?: string }>
}): ExtractedLead {
  const { responseData, questions = [] } = params

  const titlesById = new Map<string, string>()
  for (const q of questions) {
    if (q.id && q.title) titlesById.set(q.id, q.title.toLowerCase().trim())
  }

  const mappedAnswers: Record<string, string> = {}
  for (const [key, value] of Object.entries(responseData)) {
    const label = titlesById.get(key) || key
    mappedAnswers[label] = String(value ?? '')
  }

  const findByLabel = (...labels: string[]): string => {
    for (const label of labels) {
      for (const [key, val] of Object.entries(mappedAnswers)) {
        if (key.includes(label)) return val
      }
    }
    return ''
  }

  const findByType = (...types: string[]): string => {
    for (const t of types) {
      const q = questions.find(q => q.type === t)
      if (q && q.id && responseData[q.id] != null) {
        return String(responseData[q.id])
      }
    }
    return ''
  }

  const phoneRaw = findByType('phone') || findByLabel('telefone', 'phone', 'celular', 'whatsapp')

  return {
    name: findByLabel('nome', 'name', 'nome completo'),
    email: findByType('email') || findByLabel('email', 'e-mail'),
    phone: normalizePhoneE164(phoneRaw),
  }
}

/**
 * Best-effort E.164 normalization. Brazilian-friendly: assumes BR if 10-11 digits.
 * If raw already starts with +, returns as-is. If 12-13 digits, prefixes + (already has DDI).
 */
function normalizePhoneE164(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  if (digits.length === 12 || digits.length === 13) return `+${digits}`
  return digits ? `+${digits}` : ''
}
