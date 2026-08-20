/**
 * lib/capi-triggers.ts — a derivação dos GATILHOS de conversão, feita PELO SERVIDOR.
 *
 * O CORAÇÃO DO REDESENHO (18/08/2026, aprovado em parecer independente). Antes, o navegador
 * relatava "dispararam estes eventos" e o servidor conferia NOMES — o que limitava quais, mas não
 * quantos: um POST forjado com 50 ocorrências de `Purchase` gerava 50 conversões reais na conta
 * do cliente. Agora o servidor NÃO PERGUNTA: ele deriva os gatilhos da resposta que ele mesmo
 * gravou, um evento por gatilho, com a cardinalidade garantida pela UNIQUE (response_id,
 * trigger_id) do `capi_outbox`.
 *
 * O navegador contribui com UMA coisa: o `event_id` que ele usou ao disparar o pixel no instante
 * do clique (decisão do Sidney: qualificação dispara quando acontece, não na conclusão — neste
 * produto o lead parcial é capturado e trabalhado, então o qualificado que abandona É um lead).
 * Essa "dica" é só a etiqueta de deduplicação: forjá-la não infla nada, porque o evento em si só
 * existe se o servidor derivar o gatilho.
 *
 * IDENTIDADE DE GATILHO (estável, computável nos dois lados):
 *   'complete'                       → forms.pixel_event_on_complete
 *   'answerset:<ev.id>'              → forms.pixels.answerSetEvents[]
 *   'question:<questionId>:<ruleId>' → questions[].pixelEvents[]
 *   ('start' NÃO entra: é abertura, não conversão — fica só no navegador.)
 */
import { randomUUID, createHash } from 'crypto'
import { evaluateAnswerSetEvents, matchesCondition, isRecordableMetaEvent } from '@/lib/pixel-events'
import { buildQuestionPath } from '@/lib/form-logic-engine'
import { extractPIIFromAnswers } from '@/lib/meta-capi'
import type { AnswerSetEvent, PixelEventRule } from '@/types/pixel-events'
import type { QuestionConfig } from '@/lib/database.types'

export type GatilhoDerivado = {
  triggerId: string
  eventName: string
  value?: number
  currency?: string
}

const RE_ID_CONFIG = /^[A-Za-z0-9_-]{1,120}$/

/**
 * Deriva os gatilhos que a RESPOSTA GRAVADA satisfaz. Pura: sem rede, sem banco.
 *
 * Regras de contorno, cada uma com motivo:
 *  · Regra de pergunta só avalia se a pergunta está NO CAMINHO percorrível E foi RESPONDIDA —
 *    espelha o navegador (que dispara ao responder) e fecha o furo dos operadores negativos
 *    batendo em resposta ausente (P1 do parecer: `not_equals` em pergunta nunca visitada).
 *  · Conjuntos de respostas avaliam com o conjunto de ids DO CAMINHO como "existentes" — condição
 *    apontando para pergunta fora do caminho não bate, nem com operador negativo.
 *  · 'complete' só quando o formulário CONCLUIU.
 *  · NOMES REPETIDOS: um nome dispara UMA vez, na ordem complete → conjuntos → perguntas. É o
 *    comportamento de hoje (dedup por Set) — sem isto, quem configurou "Lead" na conclusão E num
 *    conjunto passaria a contar 2 no dia da virada, sem ter mudado nada.
 *  · Ids de configuração fora do formato seguro são PULADOS (não derrubam o resto): id com ':'
 *    ou lixo quebraria a identidade `answerset:<id>` e as chaves de log.
 */
export function derivarGatilhos(params: {
  onComplete?: string | null
  answerSetEvents?: AnswerSetEvent[] | null
  questions: QuestionConfig[]
  answers: Record<string, unknown>
  completed: boolean
}): GatilhoDerivado[] {
  const { onComplete, answerSetEvents, questions, answers, completed } = params
  const caminho = new Set(buildQuestionPath(questions, answers))
  const saida: GatilhoDerivado[] = []
  const nomesVistos = new Set<string>()

  const nomeOk = (n: string) => n && n.length <= 64 && isRecordableMetaEvent(n) && !nomesVistos.has(n)

  // 1. Conclusão
  const nomeComplete = (onComplete || '').trim()
  if (completed && nomeOk(nomeComplete)) {
    nomesVistos.add(nomeComplete)
    saida.push({ triggerId: 'complete', eventName: nomeComplete })
  }

  // 2. Conjuntos de respostas. `evaluateAnswerSetEvents` devolve nomes; para a identidade
  //    precisamos do id — reavaliamos por evento, reusando a MESMA função com lista unitária
  //    para não duplicar a semântica de match/minMatches em dois lugares.
  for (const ev of answerSetEvents || []) {
    if (!ev?.id || !RE_ID_CONFIG.test(ev.id)) continue
    const nome = (ev.name || '').trim()
    if (!nomeOk(nome)) continue
    const bateu = evaluateAnswerSetEvents([ev], answers, caminho).length > 0
    if (bateu) {
      nomesVistos.add(nome)
      saida.push({ triggerId: `answerset:${ev.id}`, eventName: nome })
    }
  }

  // 3. Regras por pergunta
  for (const q of questions) {
    if (!caminho.has(q.id) || !(q.id in answers)) continue
    if (!RE_ID_CONFIG.test(q.id)) continue
    for (const regra of (q.pixelEvents as PixelEventRule[] | undefined) || []) {
      if (!regra?.id || !RE_ID_CONFIG.test(regra.id)) continue
      const nome = (regra.event?.name || '').trim()
      if (!nomeOk(nome)) continue
      if (!matchesCondition(answers[q.id], regra.condition)) continue
      nomesVistos.add(nome)
      saida.push({
        triggerId: `question:${q.id}:${regra.id}`,
        eventName: nome,
        ...(typeof regra.event.value === 'number' ? { value: regra.event.value } : {}),
        ...(regra.event.currency ? { currency: regra.event.currency } : {}),
      })
    }
  }

  return saida
}

// ── AS DICAS DO NAVEGADOR ─────────────────────────────────────────────────────────────────────

const RE_TRIGGER = /^(complete|answerset:[A-Za-z0-9_-]{1,120}|question:[A-Za-z0-9_-]{1,120}:[A-Za-z0-9_-]{1,120})$/
const RE_EVENT_ID = /^[A-Za-z0-9._:-]{8,64}$/
/** 1 complete + 10 conjuntos (teto do sanitizador) + folga para regras de pergunta. */
const MAX_DICAS = 40

/**
 * Lê `capi_hints` do POST público: `[{triggerId, eventId}]`. Entrada HOSTIL por definição.
 * Devolve um mapa estrito — gatilho duplicado fica com a PRIMEIRA dica; o resto é descartado.
 * Nada aqui decide O QUE é enviado: dica sem gatilho derivado é ignorada em silêncio.
 */
export function lerDicasDoNavegador(bruto: unknown): Map<string, string> {
  const dicas = new Map<string, string>()
  if (!Array.isArray(bruto)) return dicas
  for (const item of bruto.slice(0, MAX_DICAS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const { triggerId, eventId } = item as { triggerId?: unknown; eventId?: unknown }
    if (typeof triggerId !== 'string' || typeof eventId !== 'string') continue
    const t = triggerId.trim()
    const e = eventId.trim()
    if (!RE_TRIGGER.test(t) || !RE_EVENT_ID.test(e)) continue
    if (!dicas.has(t)) dicas.set(t, e)
  }
  return dicas
}

// ── O SNAPSHOT QUE VAI PARA A FILA ────────────────────────────────────────────────────────────

function sha256(v: string): string {
  return createHash('sha256').update(v.trim().toLowerCase().replace(/\s+/g, '')).digest('hex')
}

/**
 * PII no formato do Meta, JÁ HASHEADA. Hasheia AQUI e não no envio porque o outbox é um snapshot
 * imutável: o dado em claro nunca pode dormir numa linha de fila.
 */
export function montarUserData(params: {
  answers: Record<string, unknown>
  questions: Array<{ id: string; type?: string; title?: string }>
  ip?: string
  userAgent?: string
}): Record<string, unknown> {
  const pii = extractPIIFromAnswers(params.answers, params.questions)
  const ud: Record<string, unknown> = {}
  if (pii.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(pii.email.trim())) ud.em = [sha256(pii.email)]
  if (pii.phone) {
    const dig = pii.phone.replace(/\D/g, '')
    if (dig.length >= 8 && dig.length <= 15) ud.ph = [sha256(dig)]
  }
  if (pii.firstName) ud.fn = [sha256(pii.firstName)]
  if (pii.lastName) ud.ln = [sha256(pii.lastName)]
  if (params.ip && params.ip !== 'unknown') ud.client_ip_address = params.ip
  if (params.userAgent) ud.client_user_agent = params.userAgent
  return ud
}

export type EventoParaFila = {
  trigger_id: string
  pixel_id: string
  event_name: string
  event_id: string
  event_time: string
  value?: number
  currency?: string
  action_source: string
  event_source_url?: string
  user_data: Record<string, unknown>
  test_event_code?: string
}

/**
 * Junta gatilhos derivados + dicas + contexto no formato que a função do banco recebe.
 * O `event_id` é a dica do navegador quando ela existe para AQUELE gatilho; senão, UUID do
 * servidor — que é o caso do navegador bloqueado, exatamente onde o CAPI mais vale.
 * `event_time` é o AGORA do servidor: no modelo de disparo-no-clique o salvamento acontece
 * segundos depois do clique, e hora do servidor não é forjável (parecer: 7 dias de janela não
 * são permissão para o cliente escolher atribuição).
 */
export function montarEventosParaFila(params: {
  gatilhos: GatilhoDerivado[]
  dicas: Map<string, string>
  pixelId: string
  userData: Record<string, unknown>
  eventSourceUrl?: string
  testEventCode?: string | null
}): EventoParaFila[] {
  const agora = new Date().toISOString()
  return params.gatilhos.map((g) => ({
    trigger_id: g.triggerId,
    pixel_id: params.pixelId,
    event_name: g.eventName,
    event_id: params.dicas.get(g.triggerId) ?? randomUUID(),
    event_time: agora,
    ...(typeof g.value === 'number' ? { value: g.value } : {}),
    ...(g.currency ? { currency: g.currency } : {}),
    action_source: 'website',
    ...(params.eventSourceUrl ? { event_source_url: params.eventSourceUrl } : {}),
    user_data: params.userData,
    ...(params.testEventCode ? { test_event_code: params.testEventCode } : {}),
  }))
}
