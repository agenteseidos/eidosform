const SESSION_STORAGE_KEY = 'eidosform_utm'
const LOCAL_STORAGE_KEY = 'eidosform_utm'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

type UTMKey = (typeof UTM_KEYS)[number]

export type UtmPayload = Partial<Record<UTMKey, string>>

type StoredUtms = UtmPayload & {
  captured_at: number
}

function isBrowser() {
  return typeof window !== 'undefined'
}

function sanitizeUtms(value: unknown): UtmPayload {
  if (!value || typeof value !== 'object') return {}

  return UTM_KEYS.reduce<UtmPayload>((acc, key) => {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'string' && raw.trim()) {
      acc[key] = raw.trim()
    }
    return acc
  }, {})
}

function hasUtms(utms: UtmPayload) {
  return UTM_KEYS.some((key) => Boolean(utms[key]))
}

function readSessionUtms(): UtmPayload {
  if (!isBrowser()) return {}

  try {
    return sanitizeUtms(JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null'))
  } catch {
    return {}
  }
}

function readLocalUtms(): UtmPayload {
  if (!isBrowser()) return {}

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as Partial<StoredUtms> | null
    if (!parsed || typeof parsed.captured_at !== 'number') {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
      return {}
    }

    if (Date.now() - parsed.captured_at > THIRTY_DAYS_MS) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
      return {}
    }

    return sanitizeUtms(parsed)
  } catch {
    return {}
  }
}

function persistUtms(utms: UtmPayload) {
  if (!isBrowser() || !hasUtms(utms)) return

  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(utms))
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        ...utms,
        captured_at: Date.now(),
      } satisfies StoredUtms)
    )
  } catch {
    // Ignore storage failures to avoid breaking the player
  }
}

export function captureUtms(): UtmPayload {
  if (!isBrowser()) return {}

  const params = new URLSearchParams(window.location.search)
  const urlUtms = UTM_KEYS.reduce<UtmPayload>((acc, key) => {
    const value = params.get(key)
    if (value?.trim()) {
      acc[key] = value.trim()
    }
    return acc
  }, {})

  if (hasUtms(urlUtms)) {
    persistUtms(urlUtms)
    return urlUtms
  }

  const sessionUtms = readSessionUtms()
  if (hasUtms(sessionUtms)) {
    persistUtms(sessionUtms)
    return sessionUtms
  }

  const localUtms = readLocalUtms()
  if (hasUtms(localUtms)) {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(localUtms))
    } catch {
      // Ignore storage failures
    }
    return localUtms
  }

  return {}
}

export function getUtms(): UtmPayload {
  const sessionUtms = readSessionUtms()
  if (hasUtms(sessionUtms)) return sessionUtms

  return readLocalUtms()
}

export function clearUtms() {
  if (!isBrowser()) return

  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    window.localStorage.removeItem(LOCAL_STORAGE_KEY)
  } catch {
    // Ignore storage failures
  }
}
