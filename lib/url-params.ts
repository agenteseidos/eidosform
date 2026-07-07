/**
 * lib/url-params.ts — Campos ocultos via URL (hidden fields)
 *
 * Captura parâmetros extras da query string (ex.: ?nome=...&email=...&telefone=...)
 * pra vincular a response a um lead já conhecido pelo funil, sem repetir perguntas.
 * Função de sanitização ÚNICA compartilhada entre player (client) e endpoints
 * (server) — regras nunca divergem.
 *
 * Regras (briefing docs/briefing-campos-ocultos-url.md §3 + adendo §13):
 * - utm_* e denylist de tracking ficam de fora (case-insensitive);
 * - chaves normalizadas pra minúsculas; repetida = vence a última;
 * - chave: ^[a-z0-9_-]{1,40}$ (pós-lowercase); __proto__/prototype/constructor bloqueadas;
 * - valor: trim, 1..200 chars (maior = descarta a chave — provável token, não truncar);
 * - máx. 10 chaves válidas; servidor inspeciona no máx. 50 entradas brutas;
 * - persistência client: sessionStorage POR FORM, sem localStorage (identidade
 *   não pode vazar entre visitas/pessoas — diferente de UTM, que é atribuição).
 */

export const URL_PARAMS_MAX_KEYS = 10
export const URL_PARAMS_MAX_VALUE_LENGTH = 200
const MAX_RAW_ENTRIES = 50
const KEY_REGEX = /^[a-z0-9_-]{1,40}$/

/** Chaves de tracking/ruído que nunca viram campo oculto (comparação em minúsculas). */
export const URL_PARAMS_DENYLIST = new Set([
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'msclkid',
  'mcp_token', 'igshid', 'ref', '_hsenc', '_hsmi', 'mc_cid', 'mc_eid',
])

/** Proteção contra prototype pollution. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function sanitizeEntry(rawKey: unknown, rawValue: unknown): [string, string] | null {
  if (typeof rawKey !== 'string' || typeof rawValue !== 'string') return null
  const key = rawKey.trim().toLowerCase()
  if (!key || FORBIDDEN_KEYS.has(key)) return null
  if (key.startsWith('utm_') || URL_PARAMS_DENYLIST.has(key)) return null
  if (!KEY_REGEX.test(key)) return null
  const value = rawValue.trim()
  if (!value || value.length > URL_PARAMS_MAX_VALUE_LENGTH) return null
  return [key, value]
}

/**
 * Sanitiza um objeto bruto de parâmetros (vindo do client ou do body da API).
 * Devolve objeto plano com até 10 chaves válidas, ou null se não sobrar nada.
 */
export function sanitizeUrlParams(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const clean: Record<string, string> = Object.create(null)
  let kept = 0
  let inspected = 0
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (++inspected > MAX_RAW_ENTRIES) break
    const entry = sanitizeEntry(rawKey, rawValue)
    if (!entry) continue
    if (!(entry[0] in clean)) {
      if (kept >= URL_PARAMS_MAX_KEYS) continue
      kept++
    }
    clean[entry[0]] = entry[1]
  }
  return kept > 0 ? { ...clean } : null
}

/**
 * Extrai campos ocultos de uma query string ("?a=1&b=2" ou "a=1&b=2").
 * Chave repetida: vence a ÚLTIMA ocorrência. Pura e testável.
 */
export function extractUrlParamsFromSearch(search: string): Record<string, string> | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return null
  }
  const raw: Record<string, string> = Object.create(null)
  let inspected = 0
  for (const [key, value] of params.entries()) {
    if (++inspected > MAX_RAW_ENTRIES) break
    if (FORBIDDEN_KEYS.has(key.trim().toLowerCase())) continue
    raw[key] = value // última ocorrência sobrescreve
  }
  return sanitizeUrlParams({ ...raw })
}

// ── Persistência client (sessionStorage por form) ───────────────────────────

function isBrowser() {
  return typeof window !== 'undefined'
}

function storageKey(formId: string) {
  return `eidosform_url_params_${formId}`
}

/**
 * Captura no mount do player. URL com params válidos SUBSTITUI o que estava
 * na sessão; URL sem params reutiliza o já capturado (sobrevive à navegação).
 */
export function captureUrlParams(formId: string): Record<string, string> | null {
  if (!isBrowser()) return null
  const fromUrl = extractUrlParamsFromSearch(window.location.search)
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(storageKey(formId), JSON.stringify(fromUrl))
    } catch { /* storage indisponível não quebra o player */ }
    return fromUrl
  }
  return getUrlParams(formId)
}

export function getUrlParams(formId: string): Record<string, string> | null {
  if (!isBrowser()) return null
  try {
    const raw = window.sessionStorage.getItem(storageKey(formId))
    if (!raw) return null
    return sanitizeUrlParams(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Chamar após submit final com sucesso — evita identidade velha numa nova resposta na mesma aba. */
export function clearUrlParams(formId: string) {
  if (!isBrowser()) return
  try {
    window.sessionStorage.removeItem(storageKey(formId))
  } catch { /* ignore */ }
}
