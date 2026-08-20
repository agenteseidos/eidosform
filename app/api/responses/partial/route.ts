import { NextRequest, NextResponse } from 'next/server'
import { reivindicarAnexos } from '@/lib/form-file-claim'
import { sanitizeValue } from '@/lib/form-response-security'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPartialRateLimitAsync, checkPartialCreateLimitAsync } from '@/lib/response-rate-limit'
import { upsertSubmission } from '@/lib/google-sheets'
import { logError } from '@/lib/logger'
import { pruneOrphanAnswers, pruneOffPathAnswers, validateAllAnswers } from '@/lib/field-validators'
import { signPartialToken, verifyPartialToken } from '@/lib/partial-token'
import { isValidSessionKey, hashSessionKey, hashLogPrefix, parseRevision } from '@/lib/partial-session'
import type { QuestionConfig, ResponseInsert } from '@/lib/database.types'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { PLANS } from '@/lib/plan-definitions'
import { filterQuestionsByPlan } from '@/lib/questions'
import { sanitizeUrlParams } from '@/lib/url-params'
import { PLANS as PLAN_TABLE } from '@/lib/plan-definitions'
import { derivarGatilhos, lerDicasDoNavegador, montarUserData, montarEventosParaFila } from '@/lib/capi-triggers'
import { lerPixelDoFormulario } from '@/lib/pixel-events'
import { codigoDeTesteValido } from '@/lib/meta-capi'
import { processarFila } from '@/lib/capi-worker'

/**
 * QUALIFICAÇÃO NO MEIO DO PREENCHIMENTO (18/08/2026, decisão do Sidney).
 *
 * "Se o lead é qualificado, não importa se não terminou o form" — neste produto a resposta
 * parcial é capturada e o alerta de lead incompleto existe, então o qualificado que abandona É um
 * lead trabalhável. O evento de qualificação entra na fila AQUI, no autosave, não só no submit.
 *
 * Diferenças deliberadas em relação ao submit final:
 *  · SEM transação com a gravação: o autosave REPETE — se o enfileiramento falhar agora, o
 *    próximo save rederiva e a UNIQUE (response_id, trigger_id) mantém tudo idempotente. A
 *    atomicidade só é indispensável no submit, que é a última chance.
 *  · `completed: false` na derivação: o gatilho 'complete' jamais nasce de autosave (e a função
 *    do banco tem a mesma guarda, em profundidade).
 *  · Best-effort de ponta a ponta: erro aqui NUNCA derruba o autosave — perder um save de
 *    progresso para ganhar um evento seria trocar o certo pelo duvidoso.
 */
async function enfileirarCapiDoParcial(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null }
  ownerPlan: PlanId
  responseId: string
  formQuestions: QuestionConfig[]
  answers: Record<string, unknown>
  body: Record<string, unknown>
  ip: string
  userAgent?: string
  referer?: string
}): Promise<void> {
  try {
    const { supabase, form, ownerPlan, responseId, formQuestions, answers, body } = opts
    if (body.protocol_version !== 2) return
    if (!PLAN_TABLE[ownerPlan]?.pixels) return
    const pixelDoCliente = lerPixelDoFormulario(form.pixels)
    if (!pixelDoCliente) return

    const px = (form.pixels ?? {}) as { answerSetEvents?: import('@/types/pixel-events').AnswerSetEvent[]; metaTestEventCode?: string; metaTestEventCodeAt?: string }
    const gatilhos = derivarGatilhos({
      onComplete: form.pixel_event_on_complete,
      answerSetEvents: px.answerSetEvents ?? null,
      questions: formQuestions,
      answers,
      completed: false,
    })
    if (gatilhos.length === 0) return

    // Sem credencial não há envio possível — não cria lixo na fila.
    const { data: temCred } = await supabase
      .from('form_capi_credentials').select('form_id').eq('form_id', form.id).maybeSingle()
    if (!temCred) return

    const eventos = montarEventosParaFila({
      gatilhos,
      dicas: lerDicasDoNavegador(body.capi_hints),
      pixelId: pixelDoCliente,
      userData: montarUserData({
        answers,
        questions: formQuestions as Array<{ id: string; type?: string; title?: string }>,
        ip: opts.ip, userAgent: opts.userAgent,
      }),
      eventSourceUrl: opts.referer,
      testEventCode: codigoDeTesteValido(px.metaTestEventCode, px.metaTestEventCodeAt),
    })

    const { error } = await supabase.from('capi_outbox').insert(
      eventos.map((e) => ({ ...e, response_id: responseId, form_id: form.id,
        expires_at: new Date(Date.parse(e.event_time) + 7 * 86400_000).toISOString() })) as never,
    )
    // 23505 = gatilho já enfileirado por um save anterior — o caso NORMAL do autosave repetido.
    if (error && !String((error as { code?: string }).code) .includes('23505')) {
      logError('[partial] falha ao enfileirar CAPI (não bloqueante)', error, { responseId })
      return
    }
    // Tentativa imediata: o evento de quem vai abandonar não pode esperar o cron.
    void processarFila(supabase, { responseId }).catch(() => {})
  } catch (err) {
    logError('[partial] exceção no enfileiramento CAPI (não bloqueante)', err, {})
  }
}

// POST /api/responses/partial
//
// Endpoint público (sem auth) que cria/atualiza uma row "Parcial" em
// `responses` e na planilha Google Sheets conectada ao form. Usado pelo
// form-player: handshake imediato na 1ª resposta (com defer_sheets), debounce
// de 60s nos saves seguintes e sendBeacon no fechamento da aba.
//
// Resolução do alvo (fix duplicatas 2026-07-08, auditado pelo Codex):
//   1. x-response-id + x-partial-token válidos → UPDATE da row (posse clássica).
//   2. x-partial-session (key gerada no cliente, só o SHA-256 é persistido) →
//      adota a row de (form_id, hash): completed=false → UPDATE; completed=true
//      → already_completed SEM criar nada (beacon atrasado pós-submit).
//   3. Senão → INSERT com o hash; corrida fetch×beacon resolve no índice único
//      (form_id, partial_session_hash) — 23505 → re-resolve e adota.
//
// UPDATE é condicional/atômico: .eq(completed,false) + revisão crescente
// (partial_revision) — save fora de ordem não regride respostas; Sheets só
// sincroniza após linha confirmada. defer_sheets vale SÓ na criação.
//
// Plan gating: integração Sheets já é Plus+. Se o form não tem Sheets
// habilitado, o endpoint só grava em `responses` (sem ir ao Sheets).
// O submit final continua em /api/responses; com id+token ou session key,
// ele atualiza a mesma linha pra status=Completo.

const MAX_PAYLOAD_BYTES = 50 * 1024
const MAX_ANSWER_KEYS = 200

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Response-Id, X-Partial-Token, X-Partial-Session',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}


export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'

  // Rate limit: movido pra DEPOIS da validação do form_id (fix 2026-07-08) —
  // parciais têm orçamento próprio por IP+form + teto global, separados do
  // submit final (autosaves não podem gastar a cota do submit). Ver
  // checkPartialRateLimitAsync em lib/response-rate-limit.ts.

  // Parse + size guard
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await req.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Payload muito grande' }, { status: 413, headers: CORS_HEADERS })
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { form_id, last_question_answered } = body
  const utmData = {
    utm_source: typeof body.utm_source === 'string' ? body.utm_source : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content : null,
  }
  // Campos ocultos via URL — re-sanitizados no servidor (fail-open).
  const urlParams = sanitizeUrlParams(body.url_params)

  if (!form_id || typeof form_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form_id)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  // Rate limit dos parciais: orçamento por IP+form + teto global por IP.
  const rateCheck = await checkPartialRateLimitAsync(ip, form_id)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente em instantes.' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  const answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }
  if (Object.keys(answers).length === 0) {
    // Respondente ainda não preencheu nada — nada a salvar
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return NextResponse.json({ error: 'Número de respostas excede o limite' }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createAdminClient()

  // Form + dono (precisa do plano pro gating do Sheets)
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, questions, status, is_closed, paused, google_sheets_enabled, google_sheets_id, pixels, pixel_event_on_complete')
    .eq('id', form_id)
    .eq('status', 'published')
    .single() as { data: { id: string; user_id: string; questions: QuestionConfig[]; status: string; is_closed: boolean; paused: boolean; google_sheets_enabled: boolean; google_sheets_id: string | null; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }
  if (form.is_closed || form.paused) {
    return NextResponse.json({ error: 'Formulário indisponível' }, { status: 403, headers: CORS_HEADERS })
  }

  // Sanitiza respostas órfãs ou bloqueadas pelo plano (mesma lógica do /api/responses)
  const formQuestions = (form.questions ?? []) as QuestionConfig[]
  const { data: ownerProfile, error: ownerProfileError } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', form.user_id)
    .single() as { data: { plan: string | null; plan_expires_at: string | null } | null; error: unknown }
  if (ownerProfileError || !ownerProfile) {
    logError('[partial] falha ao ler plano do dono — autosave não será podado como Free', ownerProfileError, {
      formId: form_id,
      ownerId: form.user_id,
    })
    return NextResponse.json(
      { error: 'Não foi possível validar o plano do formulário. Tente novamente.' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
  const ownerPlan = getEffectivePlan(ownerProfile)
  const effectiveQuestions = filterQuestionsByPlan(formQuestions, ownerPlan)
  const { pruned: knownAnswers } = pruneOrphanAnswers(effectiveQuestions, answers)
  // Poda por lógica condicional/saltos (hardening 2026-07-01) — não persiste
  // resposta de ramo escondido nem de pergunta pulada por salto.
  const { pruned, removedKeys: offPathKeys } = pruneOffPathAnswers(effectiveQuestions, knownAnswers)
  if (offPathKeys.length > 0) {
    console.warn('[responses/partial] off-path answer keys discarded', { form_id, offPathKeys })
  }
  if (Object.keys(pruned).length === 0) {
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }

  // last_question_answered só persiste se apontar pra pergunta EXISTENTE (Codex P3 2026-07-01).
  const lastQuestionOk =
    typeof last_question_answered === 'string' && effectiveQuestions.some((q) => q.id === last_question_answered)
      ? last_question_answered
      : null

  // Validação leve por tipo — só pra não persistir lixo. Em parcial, não
  // tomamos field_errors como erro fatal; descartamos o que não passa.
  const errs = validateAllAnswers(effectiveQuestions, pruned)
  const invalidIds = new Set(errs.map((e) => e.questionId))
  const valid: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(pruned)) {
    if (!invalidIds.has(k)) valid[k] = v
  }
  if (Object.keys(valid).length === 0) {
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }

  // sendBeacon não suporta headers — aceita response_id também via body como fallback.
  const headerResponseId = req.headers.get('x-response-id')
  const bodyResponseId = typeof body.response_id === 'string' ? body.response_id : null
  const existingResponseId = headerResponseId || bodyResponseId
  // A1 (auditoria 2026-06-10): UPDATE exige prova de posse — o partial_token
  // emitido na criação. Sem token válido, o id sozinho não autoriza sobrescrever.
  const headerPartialToken = req.headers.get('x-partial-token')
  const bodyPartialToken = typeof body.partial_token === 'string' ? body.partial_token : null
  const partialToken = headerPartialToken || bodyPartialToken

  // Session key (fix duplicatas 2026-07-08): bearer secret gerado no CLIENTE e
  // enviado em todo save (fetch/beacon/submit). Com o índice único
  // (form_id, partial_session_hash), fetch e beacon concorrentes convergem pra
  // MESMA response — o banco garante, não a aplicação. Posse da key = posse da
  // response (mesma força do partial_token). Nunca logar a key/hash completos.
  const rawSessionKey = req.headers.get('x-partial-session')
    || (typeof body.partial_session === 'string' ? body.partial_session : null)
  let sessionHash: string | null = null
  if (rawSessionKey !== null) {
    if (isValidSessionKey(rawSessionKey)) {
      sessionHash = hashSessionKey(rawSessionKey)
    } else {
      // formato inválido: ignora (vira fluxo legado) — sem material da key no log
      console.warn('[partial] session key com formato inválido — ignorada', { form_id })
    }
  }
  // Revisão do save: contador crescente do cliente. Update só aplica revisão
  // MAIOR que a armazenada (saves fora de ordem não regridem respostas).
  const revision = parseRevision(body.partial_revision)
  // defer_sheets: SÓ tem efeito na criação (handshake antecipado) — a linha do
  // Sheets nasce no próximo save, preservando o timing atual de visibilidade.
  // Em update o parâmetro é ignorado (restrição server-side, auditoria Codex).
  const deferSheets = body.defer_sheets === true

  // Contexto do CAPI: o que a derivação precisa e as funções de escrita não tinham.
  const capiCtx = {
    body: body as Record<string, unknown>,
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
    referer: req.headers.get('referer') ?? undefined,
  }
  const updateCtx = { supabase, form, ownerPlan, valid, utmData, urlParams, lastQuestionOk, formQuestions: effectiveQuestions, revision, capiCtx }

  // 1) Caminho id+token (prova de posse clássica)
  if (existingResponseId && verifyPartialToken(partialToken, existingResponseId)) {
    const { data: existing } = await supabase
      .from('responses')
      .select('id, sheets_row_index, form_id, completed, url_params, partial_revision')
      .eq('id', existingResponseId)
      .single() as { data: PartialTarget | null; error: unknown }

    if (existing && existing.form_id === form_id) {
      if (existing.completed) {
        // Já foi finalizado — não regredir pra parcial
        return NextResponse.json({ response_id: existing.id, skipped: 'already_completed' }, { status: 200, headers: CORS_HEADERS })
      }
      return await updatePartialResponse({ ...updateCtx, target: existing })
    }
    // id stale/de outro form: cai pro fluxo por session key / criação
  }

  // 2) Sem id+token válidos: adoção por session key — cobre o parcial criado
  //    por sendBeacon, cuja resposta o cliente nunca conseguiu ler.
  if (sessionHash) {
    const { data: bySession } = await supabase
      .from('responses')
      .select('id, sheets_row_index, form_id, completed, url_params, partial_revision')
      .eq('form_id', form_id)
      .eq('partial_session_hash', sessionHash)
      .maybeSingle() as { data: PartialTarget | null; error: unknown }

    if (bySession) {
      if (bySession.completed) {
        // Beacon atrasado pós-submit / storage velho: NÃO cria nem modifica
        // nada (decisão da auditoria — a key identifica UMA tentativa; nova
        // tentativa legítima usa key nova, o cliente rotaciona).
        return NextResponse.json({ response_id: bySession.id, skipped: 'already_completed' }, { status: 200, headers: CORS_HEADERS })
      }
      console.log('[partial] adoção por session key', { form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: bySession.id })
      return await updatePartialResponse({ ...updateCtx, target: bySession })
    }
  }

  // 3) Criação (com hash quando houver; corrida de INSERT resolve por 23505)
  //
  // Orçamento SEPARADO para CRIAR (auditoria 2026-08, lote 2 · L2-5). O teto geral de 30/min
  // cobre o tráfego de parciais mas não distingue criar de atualizar — e uma sessão legítima
  // cria UMA linha e depois só atualiza. Em loop, um atacante criava ~43 mil linhas/dia num
  // formulário; o estrago não é o banco, é que cada linha vira "lead abandonado" em 30 min e
  // dispara e-mail PAGO ao dono, afogando os abandonos reais. Aplicado só aqui: o POST que é
  // atualização (caminhos 1 e 2 acima) não gasta este orçamento.
  const createCheck = await checkPartialCreateLimitAsync(ip, form_id)
  if (!createCheck.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  // ANEXO: prova o vínculo (form + pergunta + ficha viva) e deixa o SERVIDOR montar a URL.
  // Sem isto, esta rota persistia o objeto CRU vindo do navegador — e o validador, ao ver um
  // `file_id` qualquer, deixava passar junto uma `url` externa escolhida pelo atacante, que
  // viajava para painel, planilha, webhook, e-mail e WhatsApp. (P0 achado em 16/08.)
  const validComAnexos = await reivindicarAnexos(supabase, {
    formId: form.id as string, responseId: null, answers: valid as Record<string, unknown>,
  }) as typeof valid

  return await createPartialResponse({
    capiCtx,
    supabase, form, ownerPlan, answers: validComAnexos, utmData, urlParams,
    lastQuestionAnswered: lastQuestionOk, formQuestions: effectiveQuestions,
    sessionHash, revision, deferSheets, updateCtx,
  })
}

interface PartialTarget {
  id: string
  sheets_row_index: number | null
  form_id: string
  completed: boolean
  url_params?: Record<string, string> | null
  partial_revision?: number | null
}

// UPDATE condicional de uma parcial existente. Duas condições atômicas no
// próprio UPDATE (auditoria Codex 2026-07-08): completed=false (um submit que
// vença a corrida não é sobrescrito com estado parcial) e revisão crescente
// (um save fora de ordem não regride respostas). Sheets SÓ sincroniza após
// linha confirmada.
async function updatePartialResponse(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null }
  ownerPlan: PlanId
  target: PartialTarget
  valid: Record<string, unknown>
  utmData: Record<string, string | null>
  urlParams: Record<string, string> | null
  lastQuestionOk: string | null
  formQuestions: QuestionConfig[]
  revision: number | null
  capiCtx: { body: Record<string, unknown>; ip: string; userAgent?: string; referer?: string }
}): Promise<NextResponse> {
  const { supabase, form, ownerPlan, target, valid, utmData, urlParams, lastQuestionOk, formQuestions, revision, capiCtx } = opts

  // url_params: novo valor válido atualiza; ausente PRESERVA o da parcial.
  const effectiveUrlParams = urlParams ?? sanitizeUrlParams(target.url_params) ?? null

  let query = supabase
    .from('responses')
    .update({
      answers: valid as Record<string, import('@/lib/database.types').Json>,
      last_question_answered: lastQuestionOk,
      // Bate o relógio de atividade a cada autosave — é o que o cron de lead
      // abandonado usa pra saber "quando foi a ÚLTIMA vez que mexeu" (não mais
      // "quando começou"). Coluna criada 2026-07-23 (migration manual).
      last_activity_at: new Date().toISOString(),
      ...utmData,
      ...(urlParams ? { url_params: urlParams } : {}),
      ...(revision !== null ? { partial_revision: revision } : {}),
    })
    .eq('id', target.id)
    .eq('completed', false)
  if (revision !== null) {
    query = query.or(`partial_revision.is.null,partial_revision.lt.${revision}`)
  }
  const { data: updatedRows, error: updateError } = await query.select('id') as { data: { id: string }[] | null; error: unknown }

  if (updateError) {
    logError('[partial] update responses failed', updateError, { responseId: target.id })
    return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
  }
  if (!updatedRows || updatedRows.length === 0) {
    // Nada gravado: ou o submit completou no meio (corrida), ou a revisão é
    // obsoleta (save fora de ordem). Não toca no Sheets.
    return NextResponse.json(
      { response_id: target.id, partial_token: signPartialToken(target.id), skipped: 'stale_or_completed' },
      { status: 200, headers: CORS_HEADERS }
    )
  }

  // Qualificação no meio do preenchimento: deriva e enfileira AGORA (best-effort; a UNIQUE
  // do banco mantém idempotente através dos autosaves repetidos).
  await enfileirarCapiDoParcial({
    supabase, form: form as never, ownerPlan, responseId: target.id,
    formQuestions, answers: valid, body: capiCtx.body,
    ip: capiCtx.ip, userAgent: capiCtx.userAgent, referer: capiCtx.referer,
  })

  await syncToSheetsIfEnabled({
    supabase,
    form,
    ownerPlan,
    answers: valid,
    utmData,
    urlParams: effectiveUrlParams,
    responseId: target.id,
    formQuestions,
    currentRowIndex: target.sheets_row_index,
  })

  return NextResponse.json(
    { response_id: target.id, partial_token: signPartialToken(target.id) },
    { status: 200, headers: CORS_HEADERS }
  )
}

async function createPartialResponse(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null }
  ownerPlan: PlanId
  answers: Record<string, unknown>
  utmData: Record<string, string | null>
  urlParams: Record<string, string> | null
  lastQuestionAnswered: unknown
  formQuestions: QuestionConfig[]
  sessionHash: string | null
  revision: number | null
  deferSheets: boolean
  capiCtx: { body: Record<string, unknown>; ip: string; userAgent?: string; referer?: string }
  updateCtx: {
    supabase: ReturnType<typeof createAdminClient>
    form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null }
    ownerPlan: PlanId
    valid: Record<string, unknown>
    utmData: Record<string, string | null>
    urlParams: Record<string, string> | null
    lastQuestionOk: string | null
    formQuestions: QuestionConfig[]
    revision: number | null
    capiCtx: { body: Record<string, unknown>; ip: string; userAgent?: string; referer?: string }
  }
}): Promise<NextResponse> {
  const { supabase, form, ownerPlan, answers, utmData, urlParams, lastQuestionAnswered, formQuestions, sessionHash, revision, deferSheets, updateCtx } = opts
  const insertPayload: ResponseInsert = {
    form_id: form.id,
    answers: answers as Record<string, import('@/lib/database.types').Json>,
    completed: false,
    last_question_answered: typeof lastQuestionAnswered === 'string' ? lastQuestionAnswered : null,
    utm_source: utmData.utm_source,
    utm_medium: utmData.utm_medium,
    utm_campaign: utmData.utm_campaign,
    utm_term: utmData.utm_term,
    utm_content: utmData.utm_content,
    url_params: urlParams,
    ...(sessionHash ? { partial_session_hash: sessionHash } : {}),
    ...(revision !== null ? { partial_revision: revision } : {}),
  }

  const { data: created, error: insertError } = await supabase
    .from('responses')
    .insert(insertPayload)
    .select('id')
    .single() as { data: { id: string } | null; error: { code?: string } | null }

  if (insertError || !created) {
    // 23505 no índice único (form_id, partial_session_hash): fetch e beacon da
    // MESMA sessão correram — a row já nasceu pela outra requisição. Re-resolve
    // e ADOTA em vez de falhar (é exatamente o desenho: o banco converge).
    if (insertError?.code === '23505' && sessionHash) {
      const { data: raced } = await supabase
        .from('responses')
        .select('id, sheets_row_index, form_id, completed, url_params, partial_revision')
        .eq('form_id', form.id)
        .eq('partial_session_hash', sessionHash)
        .maybeSingle() as { data: PartialTarget | null; error: unknown }
      if (raced) {
        if (raced.completed) {
          return NextResponse.json({ response_id: raced.id, skipped: 'already_completed' }, { status: 200, headers: CORS_HEADERS })
        }
        console.log('[partial] corrida de criação resolvida por adoção (23505)', { formId: form.id, hashPrefix: hashLogPrefix(sessionHash), responseId: raced.id })
        return await updatePartialResponse({ ...updateCtx, target: raced })
      }
    }
    logError('[partial] insert responses failed', insertError, { formId: form.id })
    return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
  }

  // Primeira gravação também deriva: pergunta qualificadora logo na abertura entra aqui.
  await enfileirarCapiDoParcial({
    supabase, form: form as never, ownerPlan, responseId: created.id,
    formQuestions, answers, body: opts.capiCtx.body,
    ip: opts.capiCtx.ip, userAgent: opts.capiCtx.userAgent, referer: opts.capiCtx.referer,
  })

  // defer_sheets (só na criação): o handshake antecipado captura id/token sem
  // antecipar a linha na planilha — ela nasce no próximo save (60s/beacon).
  if (!deferSheets) {
    await syncToSheetsIfEnabled({
      supabase,
      form,
      ownerPlan,
      answers,
      utmData,
      urlParams,
      responseId: created.id,
      formQuestions,
      currentRowIndex: null,
    })
  }

  return NextResponse.json(
    { response_id: created.id, partial_token: signPartialToken(created.id) },
    { status: 201, headers: CORS_HEADERS }
  )
}

async function syncToSheetsIfEnabled(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null; pixels: Record<string, unknown> | null; pixel_event_on_complete: string | null }
  ownerPlan: PlanId
  answers: Record<string, unknown>
  utmData: Record<string, string | null>
  urlParams: Record<string, string> | null
  responseId: string
  formQuestions: QuestionConfig[]
  currentRowIndex: number | null
}): Promise<void> {
  const { supabase, form, ownerPlan, answers, utmData, urlParams, responseId, formQuestions, currentRowIndex } = opts
  if (!form.google_sheets_enabled || !form.google_sheets_id) return

  // Revalida o plano do dono NO ENVIO, igual ao fluxo final (/api/responses:
  // ownerPlanConfig?.googleSheets). Sem isto, downgrade abaixo de Starter
  // continuava escrevendo autosaves na planilha até a resposta finalizar
  // (auditoria LP 2026-07-28). Sheets é Starter+, não Plus+ como dizia o
  // comentário antigo.
  if (!PLANS[ownerPlan]?.googleSheets) return

  const fieldLabels = formQuestions.map((q) => q.title || 'Sem título')
  const questionIdToLabel: Record<string, string> = {}
  for (const q of formQuestions) questionIdToLabel[q.id] = q.title || 'Sem título'

  try {
    const result = await upsertSubmission({
      spreadsheetId: form.google_sheets_id,
      fieldLabels,
      answers,
      questionIdToLabel,
      utmData,
      urlParams,
      responseId,
      status: 'Parcial',
      rowIndex: currentRowIndex,
    })
    // Se foi append e capturou rowIndex novo, persiste pra próximos UPDATEs
    if (result.rowIndex && result.rowIndex !== currentRowIndex) {
      await supabase
        .from('responses')
        .update({ sheets_row_index: result.rowIndex })
        .eq('id', responseId)
    }
  } catch (e) {
    logError('[partial] sheets sync failed', e, { responseId })
  }
}
