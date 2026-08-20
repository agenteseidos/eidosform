/**
 * lib/pixel-events.ts — Pixel Events condicionais
 * Avalia regras por pergunta e dispara eventos no Meta Pixel.
 */

import { PixelEventRule, PixelEventCondition, PixelEventConfig, AnswerSetEvent } from '@/types/pixel-events'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    ttq?: { track: (event: string, params?: Record<string, unknown>) => void }
    __eidosCapturedFbqEvents?: string[]
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Empurra um evento pro dataLayer do GTM/Google.
 * Espelha os mesmos eventos da aba CONVERSÕES (já usados pelo Meta) para o
 * Google: o GTM/gtag escutam e disparam conversões do Google Ads/GA4.
 * Dispara na hora — NÃO depende do fbq/Meta estar carregado e NÃO altera
 * em nada o comportamento do Meta.
 */
export function pushDataLayerEvent(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !event) return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...(params || {}) })
}

/**
 * DISPARO POR GATILHO (18/08/2026, protocolo v2) — o contrato do instante do clique.
 *
 * O navegador avalia a regra localmente e dispara o pixel NA HORA (decisão do Sidney: a
 * qualificação vale quando acontece). Cada disparo gera um `eventId` e registra a DICA
 * `{triggerId, eventId}`, que viaja nos salvamentos. O servidor deriva os gatilhos SOZINHO da
 * resposta gravada — a dica é só a etiqueta de deduplicação, para o envio server-side usar o
 * mesmo id e o Meta juntar as duas vias. Forjar dica não infla nada.
 *
 * Um gatilho dispara UMA vez por preenchimento (`__eidosCapiDisparados`); o servidor tem a mesma
 * garantia na UNIQUE (response_id, trigger_id) da fila.
 */
export type CapiHint = { triggerId: string; eventId: string }

function novoEventId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* segue para o plano B */ }
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** As dicas acumuladas desta página, no formato que viaja no POST. */
export function dicasParaEnvio(): CapiHint[] {
  if (typeof window === 'undefined') return []
  return [...(window.__eidosCapiHints ?? [])]
}

export function gatilhoJaDisparado(triggerId: string): boolean {
  if (typeof window === 'undefined') return false
  return (window.__eidosCapiDisparados ?? new Set()).has(triggerId)
}

/**
 * Dispara UM gatilho no navegador (fbq com eventID + dataLayer + ttq) e registra a dica.
 * `eventId` explícito = veio do servidor (browser_events pós-submit); ausente = clique local,
 * o navegador gera e o servidor adota via dica. Repetição do mesmo gatilho é ignorada.
 */
export function dispararGatilho(params: {
  triggerId: string
  eventName: string
  eventId?: string
  value?: number
  currency?: string
}): void {
  if (typeof window === 'undefined' || !params.eventName) return
  if (!window.__eidosCapiDisparados) window.__eidosCapiDisparados = new Set()
  if (window.__eidosCapiDisparados.has(params.triggerId)) return
  window.__eidosCapiDisparados.add(params.triggerId)

  const eventId = params.eventId ?? novoEventId()
  if (!window.__eidosCapiHints) window.__eidosCapiHints = []
  window.__eidosCapiHints.push({ triggerId: params.triggerId, eventId })

  // Nomes seguem para o buffer legado: a UI de "eventos capturados" ainda lê dele.
  if (!window.__eidosCapturedFbqEvents) window.__eidosCapturedFbqEvents = []
  window.__eidosCapturedFbqEvents.push(params.eventName)

  // GTM/Google — sem eventID (conceito do Meta).
  pushDataLayerEvent(params.eventName)
  fireFbqComId(params.eventName, eventId, params.value, params.currency)
  fireTtqEvent(params.eventName)
}

function fireFbqComId(name: string, eventID: string, value?: number, currency?: string, retries = 10) {
  if (typeof window === 'undefined') return
  const { fbq } = window
  if (!fbq) {
    if (retries > 0) setTimeout(() => fireFbqComId(name, eventID, value, currency, retries - 1), 300)
    return
  }
  const params = value !== undefined ? { value, currency: currency || 'BRL' } : undefined
  const standardEvents = ['Lead', 'Purchase', 'CompleteRegistration', 'Contact', 'InitiateCheckout', 'ViewContent', 'AddToCart', 'AddPaymentInfo', 'Subscribe']
  if (standardEvents.includes(name)) {
    fbq('track', name, params ?? {}, { eventID })
  } else {
    fbq('trackCustom', name, params ?? {}, { eventID })
  }
}

function normalizeAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return ''
  if (Array.isArray(answer)) return answer.join(', ')
  return String(answer)
}

function parseNumericValue(value: string): number {
  return parseFloat(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'))
}

export function matchesCondition(answer: unknown, condition: PixelEventCondition): boolean {
  // Resposta em array (checkboxes): avaliar elemento a elemento — operador
  // positivo casa se ALGUMA opção marcada casar; negativo é a negação exata
  // do positivo correspondente ("não marcou X"). O join(', ') antigo quebrava
  // equals/one_of com múltiplas opções marcadas.
  if (Array.isArray(answer)) {
    const items = answer.filter(a => a !== null && a !== undefined && String(a).trim() !== '')
    switch (condition.operator) {
      case 'is_empty': return items.length === 0
      case 'is_not_empty': return items.length > 0
      case 'not_equals': return !items.some(a => matchesCondition(a, { ...condition, operator: 'equals' }))
      case 'not_contains': return !items.some(a => matchesCondition(a, { ...condition, operator: 'contains' }))
      case 'not_one_of': return !items.some(a => matchesCondition(a, { ...condition, operator: 'one_of' }))
      default: return items.some(a => matchesCondition(a, condition))
    }
  }

  const { operator, value } = condition
  const normalizedAnswer = normalizeAnswer(answer)
  const answerLower = normalizedAnswer.toLowerCase()
  const valueLower = (value ?? '').toLowerCase()

  switch (operator) {
    case 'equals': return answerLower === valueLower
    case 'not_equals': return answerLower !== valueLower
    case 'contains': return answerLower.includes(valueLower)
    case 'not_contains': return !answerLower.includes(valueLower)
    case 'greater_than': return parseNumericValue(normalizedAnswer) > parseNumericValue(value)
    case 'less_than': return parseNumericValue(normalizedAnswer) < parseNumericValue(value)
    case 'is_empty': return normalizedAnswer.trim() === ''
    case 'is_not_empty': return normalizedAnswer.trim() !== ''
    // Lista de valores separados por "|" — casa se a resposta for igual a
    // qualquer um deles (comparação exata, case-insensitive).
    case 'one_of':
      return splitOptionList(valueLower).includes(answerLower.trim())
    case 'not_one_of':
      return !splitOptionList(valueLower).includes(answerLower.trim())
    default: return false
  }
}

function splitOptionList(value: string): string[] {
  return value.split('|').map(v => v.trim()).filter(v => v !== '')
}

/**
 * Dispara um evento no TikTok Pixel (ttq). O snippet oficial cria o stub
 * `window.ttq` com fila — eventos disparados antes da lib carregar são
 * enfileirados. O retry cobre só o caso do Script afterInteractive ainda
 * não ter executado. ttq.track aceita eventos padrão e custom pelo nome.
 */
function fireTtqEvent(name: string, params?: Record<string, unknown>, retries = 10) {
  if (!name || typeof window === 'undefined') return
  const { ttq } = window
  if (!ttq) {
    if (retries > 0) {
      setTimeout(() => fireTtqEvent(name, params, retries - 1), 300)
    }
    return
  }
  ttq.track(name, params)
}

/**
 * Formato de um ID de conversão do Google Ads. Mesmo padrão que `app/f/[slug]/page.tsx` usa antes
 * de interpolar o ID no script inline — só dígitos, sem aspa, sem `<`, sem `)`.
 */
const GOOGLE_ADS_ID_RE = /^AW-\d+$/

/**
 * Formato de um RÓTULO de conversão. O Google gera algo como `AbC-D_efGhIjk`: letras, dígitos,
 * hífen e sublinhado.
 *
 * `{1,64}` de propósito — não existe mínimo documentado, e exigir 6+ caracteres transformaria um
 * rótulo curto e legítimo em `null` silencioso, que é exatamente o defeito que este código veio
 * consertar.
 */
const GOOGLE_ADS_LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Monta o `send_to` da conversão do Google Ads, ou `null` se a configuração não servir.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────────────────────────
 * O campo "Rótulo de conversão" existe no construtor desde sempre, o cliente preenche, e NADA
 * nunca disparou: não havia um único `gtag('event','conversion')` no projeto. A página injeta
 * `gtag('config','AW-XXX')`, que registra uma visita — nunca uma conversão. Dado morto de ponta a
 * ponta, com o `docs/audit-venda-conversao.md` afirmando que estava "✅ Completo".
 *
 * ── SEGURANÇA ─────────────────────────────────────────────────────────────────────────────────
 * ⚠️ O rótulo é digitado pelo DONO e roda no navegador de TODO lead. Aqui ele viaja como ARGUMENTO
 * de função (`gtag('event','conversion',{send_to})`) — é dado, não código-fonte, então não há
 * como quebrar literal nem fechar `</script>`.
 *
 * 🛑 Se um dia alguém levar o rótulo para um `dangerouslySetInnerHTML` (o padrão que os 4 pixels
 * usam em `page.tsx`), a regex vira OBRIGATÓRIA antes da interpolação — sem ela,
 * `x'});alert(document.cookie);({'z':'` quebra o literal e executa. A CSP com nonce NÃO protege
 * desse caso, porque o código roda dentro do mesmo script já autorizado.
 *
 * As regexes aqui são de CORREÇÃO, não de contenção: `send_to` malformado faz a conversão falhar
 * calada no Google, que é o mesmo tipo de silêncio que se está consertando.
 */
export function buildGoogleAdsSendTo(
  adsId: unknown,
  label: unknown
): string | null {
  const id = String(adsId ?? '').trim()
  const lbl = String(label ?? '').trim()
  if (!id || !lbl) return null
  if (!GOOGLE_ADS_ID_RE.test(id)) return null

  // Tolerância deliberada: é comum colar do painel do Google o `send_to` inteiro
  // (`AW-123/AbC-D_efG`) dentro do campo de rótulo. Aceitar isso evita transformar um erro
  // compreensível de quem não é técnico num campo que não funciona e não diz por quê.
  const soLabel = lbl.includes('/') ? lbl.slice(lbl.lastIndexOf('/') + 1) : lbl
  if (!GOOGLE_ADS_LABEL_RE.test(soLabel)) return null

  return `${id}/${soLabel}`
}

/**
 * Dispara a conversão do Google Ads.
 *
 * O snippet injetado em `page.tsx` declara `function gtag(){dataLayer.push(arguments)}` — uma
 * função de topo em script clássico, então `window.gtag` existe SINCRONAMENTE assim que o inline
 * roda, e o corpo é fila pura. Chamar antes de `gtag/js` terminar de baixar é seguro: o comando
 * fica enfileirado. E o `gtag('config',...)` do mesmo inline já está na frente na fila, então a
 * conversão nunca chega antes do destino estar registrado.
 *
 * O retry cobre só o caso do `<Script strategy="afterInteractive">` ainda não ter executado —
 * mesmo molde do `fbq` e do `ttq`, por consistência.
 */
export function fireGoogleAdsConversion(sendTo: string | null, retries = 10) {
  if (!sendTo || typeof window === 'undefined') return
  const { gtag } = window
  if (!gtag) {
    if (retries > 0) {
      setTimeout(() => fireGoogleAdsConversion(sendTo, retries - 1), 300)
    }
    return
  }
  gtag('event', 'conversion', { send_to: sendTo })
}

export function fireNamedPixelEvent(name: string) {
  if (!name) return
  // Google/GTM — dispara uma vez, imediatamente (independe do fbq).
  pushDataLayerEvent(name)
  // Meta — comportamento inalterado (espera o fbq carregar, com retry).
  fireFbqNamedEvent(name)
  // TikTok — mesmo padrão do Meta (espera o ttq carregar, com retry).
  fireTtqEvent(name)
}

function fireFbqNamedEvent(name: string, retries = 10) {
  if (!name || typeof window === 'undefined') return
  const { fbq } = window
  if (!fbq) {
    // fbq ainda não carregou — tentar novamente em 300ms (até 10x = 3s)
    if (retries > 0) {
      setTimeout(() => fireFbqNamedEvent(name, retries - 1), 300)
    }
    return
  }
  // Uso remanescente: SÓ o evento de abertura (on_start), que por decisão não tem par no
  // servidor — logo não gera dica nem precisa de eventID casado. Registra o nome no buffer
  // legado (UI de eventos capturados) e dispara.
  if (!window.__eidosCapturedFbqEvents) window.__eidosCapturedFbqEvents = []
  window.__eidosCapturedFbqEvents.push(name)
  const standardEvents = ['Lead', 'Purchase', 'CompleteRegistration', 'Contact', 'InitiateCheckout', 'ViewContent', 'AddToCart', 'AddPaymentInfo', 'Subscribe']
  if (standardEvents.includes(name)) {
    fbq('track', name)
  } else {
    fbq('trackCustom', name)
  }
}

/**
 * Avalia os eventos por conjunto de respostas (forms.pixels.answerSetEvents)
 * e devolve os NOMES (deduplicados) dos eventos que devem disparar. Pura e
 * testável — o disparo em si fica com o caller (player), que só dispara após
 * o POST da response ter sucesso.
 *
 * `existingQuestionIds`: condição apontando pra pergunta que não existe mais
 * no form = NÃO batida, inclusive pra operadores negativos (not_equals etc.) —
 * sem isso, pergunta apagada viraria falso positivo e contaminaria a campanha.
 * Pergunta que existe mas não foi respondida avalia normalmente (is_empty é
 * caso de uso legítimo).
 */
export function evaluateAnswerSetEvents(
  events: AnswerSetEvent[] | null | undefined,
  answers: Record<string, unknown>,
  existingQuestionIds: Set<string>,
): string[] {
  const names: string[] = []
  for (const ev of events || []) {
    const name = (ev.name || '').trim()
    const conditions = ev.conditions || []
    if (!name || conditions.length === 0) continue
    const matched = conditions.filter(c =>
      existingQuestionIds.has(c.questionId) && matchesCondition(answers[c.questionId], c.condition),
    ).length
    // minMatches > nº de condições (config inválida que o Zod passou a rejeitar,
    // mas pode existir em JSONB antigo) = nunca dispara — conservador, não gera
    // conversão inesperada. minMatches ausente em 'at_least' = exige todas.
    const required = ev.match === 'all'
      ? conditions.length
      : Math.max(1, ev.minMatches ?? conditions.length)
    if (matched >= required && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Prepara answerSetEvents pro save: descarta rascunhos que o Zod rejeitaria
 * (evento sem nome, condição sem pergunta) sem quebrar o save do form inteiro,
 * e clampa minMatches em [1, nº de condições]. Devolve undefined quando não
 * sobra nada (JSON.stringify remove a chave do payload).
 */
export function sanitizeAnswerSetEvents(events: AnswerSetEvent[] | null | undefined): AnswerSetEvent[] | undefined {
  const clean: AnswerSetEvent[] = []
  for (const ev of events || []) {
    const name = (ev.name || '').trim()
    const conditions = (ev.conditions || []).filter(c => (c.questionId || '').trim() !== '').slice(0, 20)
    if (!name || conditions.length === 0) continue
    clean.push({
      id: ev.id,
      name,
      match: ev.match === 'at_least' ? 'at_least' : 'all',
      ...(ev.match === 'at_least'
        ? { minMatches: Math.min(Math.max(1, ev.minMatches ?? 1), conditions.length) }
        : {}),
      conditions,
    })
  }
  return clean.length > 0 ? clean.slice(0, 10) : undefined
}

export const STANDARD_PIXEL_EVENTS = [
  'Lead',
  'Purchase',
  'CompleteRegistration',
  'Contact',
  'InitiateCheckout',
  'ViewContent',
] as const

/**
 * Decide se um evento capturado do fbq entra no `responses.meta_events` (o
 * "carimbo" de conversão da resposta, exibido na lista de respostas e nos
 * exports). Eventos padrão genéricos/ruidosos ficam de fora; os padrão de
 * CONVERSÃO (Lead, Purchase, CompleteRegistration, InitiateCheckout) e todos
 * os nomes personalizados são gravados — decisão de produto 2026-07-07.
 */
const SUPPRESSED_META_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Search',
  'AddToCart',
  'AddToWishlist',
  'AddPaymentInfo',
])

/**
 * O Pixel do Meta configurado no formulário — FONTE ÚNICA.
 *
 * Existe porque havia três leituras diferentes do mesmo campo (parecer independente, 18/08/2026):
 * a página pública aceitava quatro apelidos (`metaPixelId`, `facebook`, `meta_pixel_id`,
 * `pixel_meta`, herdados de versões antigas do construtor), enquanto o CAPI e a rota do token
 * liam só `metaPixelId`. Resultado: um formulário antigo rastrearia no navegador e não teria
 * CAPI — e o cliente veria "preencha o Pixel ID" com o Pixel preenchido na tela.
 *
 * Devolve `null` se não for um Pixel plausível: o do Meta é sempre numérico.
 */
export function lerPixelDoFormulario(pixels: unknown): string | null {
  if (!pixels || typeof pixels !== 'object') return null
  const px = pixels as Record<string, unknown>
  const bruto = [px.metaPixelId, px.facebook, px.meta_pixel_id, px.pixel_meta]
    .find((v) => typeof v === 'string' && v.trim())
  if (typeof bruto !== 'string') return null
  const limpo = bruto.trim()
  return /^\d{10,20}$/.test(limpo) ? limpo : null
}

/**
 * O endereço da aba Configurações DO PIXEL no Gerenciador de Eventos — onde fica o botão que gera
 * o token da API de Conversões.
 *
 * Devolve `null` sem um Pixel válido, e é esse o ponto: a versão anterior montava a URL com o
 * valor cru do campo, e um campo vazio virava `/list/dataset//settings` — 404 na cara do cliente
 * (pego pelo Sidney em 18/08/2026). Aqui o caso impossível não é evitado por disciplina de quem
 * escreve a tela; ele simplesmente não tem como ser construído.
 *
 * ⚠️ NUNCA acrescentar `business_id`, `act` ou `nav_source`. A URL que se copia do navegador vem
 * com os três, e eles identificam a conta e a conta de anúncios de QUEM COPIOU — embutir isso no
 * produto serviria os identificadores do dono da plataforma a todo cliente que clicasse. O Meta
 * resolve o contexto pela sessão de quem abre.
 */
export function linkConfiguracoesDoPixel(pixelId: string | null | undefined): string | null {
  const limpo = (pixelId ?? '').trim()
  if (!/^\d{10,20}$/.test(limpo)) return null
  return `https://eventsmanager.facebook.com/events_manager2/list/dataset/${limpo}/settings`
}

export function isRecordableMetaEvent(name: string): boolean {
  return name.trim() !== '' && !SUPPRESSED_META_EVENTS.has(name)
}

export const OPERATOR_LABELS: Record<string, string> = {
  equals: 'é igual a',
  not_equals: 'não é igual a',
  contains: 'contém',
  not_contains: 'não contém',
  greater_than: 'é maior que',
  less_than: 'é menor que',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
  one_of: 'é uma das opções (separe com |)',
  not_one_of: 'não é nenhuma das opções (separe com |)',
}

export const VALUE_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'one_of', 'not_one_of']
