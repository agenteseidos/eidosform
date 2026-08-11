import type { ResponseInsert, ResponseUpdate, AnswerItemInsert, QuestionConfig } from '@/lib/database.types'
import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkAndIncrementResponseCount, sendNearLimitAlert, PLANS } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plans'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'
import { isRecordableMetaEvent } from '@/lib/pixel-events'
import { extractLead } from '@/lib/lead-extraction'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { validateAllAnswers, pruneOrphanAnswers, pruneOffPathAnswers } from '@/lib/field-validators'
import { isResponseComplete, sanitizeValue } from '@/lib/form-response-security'
import { sendWhatsAppOnFormResponse } from '@/lib/integration-stubs'
import { canUseLeadWhatsApp } from '@/lib/whatsapp-capability'
import { upsertSubmission } from '@/lib/google-sheets'
import { logError, logWarn } from '@/lib/logger'
import { sendMetaCAPIEvent, extractPIIFromAnswers } from '@/lib/meta-capi'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { signPartialToken, verifyPartialToken } from '@/lib/partial-token'
import { isValidSessionKey, hashSessionKey, hashLogPrefix } from '@/lib/partial-session'
import { extractIdentity, identitiesMatch } from '@/lib/identity-match'
import { sanitizeUrlParams } from '@/lib/url-params'
import { buildNotificationModel } from '@/lib/notification-model'
import { resolveEmailRecipients, sendNewResponseEmails } from '@/lib/notification-email'
import { enfileirarReenvio } from '@/lib/email-retry-queue'
import { filterQuestionsByPlan } from '@/lib/questions'

// Teto do payload: 50 KB (P2-3/P3-2 da auditoria de maio: o comentário dizia 1MB
// e mentia — 50 KB cobre forms longos de texto; arquivo vai por upload próprio).
const MAX_PAYLOAD_BYTES = 50 * 1024
// Maximum number of answer keys (prevents flooding with fake question ids)
const MAX_ANSWER_KEYS = 200

// SECURITY NOTE: CORS * is intentional — this endpoint must be callable from any
// domain where forms are embedded (custom domains, landing pages, etc.).
// The service_role key is used server-side only (never exposed to the client).
// Protection layers:
//   1. Rate limit per IP (10 req/min via Supabase RPC + in-memory fallback)
//   2. Honeypot field (_hp_) to trap bots
//   3. Payload size + answer key count limits
//   4. Form must exist and be 'published' (validated before insert)
//   5. Response limit per user plan (prevents infinite submissions)
//   6. UUID format validation on form_id (prevents probing)
//   7. Input sanitization (HTML tag stripping)
//
// TODO [SECURITY]: Add optional Turnstile/hCaptcha validation per form.
//   Form owner enables in settings, form-player sends cf-turnstile-response token,
//   this endpoint validates with Cloudflare before accepting submission.
//   See: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Response-Id, X-Partial-Token, X-Partial-Session',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS /api/responses — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}


// Serializa valor de resposta para answer_items (coluna text)
// Tipos complexos (objeto, array) são serializados como JSON
function serializeAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// POST /api/responses — submeter resposta (completa ou parcial)
export async function POST(req: NextRequest) {
  try {
  // Bug #2: Rate limit — max 10 per minute per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rateCheck = await checkResponseRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.', retryAfter },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // Payload size check (defense against large payloads)
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'Payload muito grande' },
      { status: 413, headers: CORS_HEADERS }
    )
  }

  // Use service-role client for anonymous submissions (no auth required)
  const supabase = createServiceRoleClient()

  // Bug #6: Catch invalid JSON
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await req.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload muito grande' },
        { status: 413, headers: CORS_HEADERS }
      )
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { form_id, last_question_answered, respondent_id } = body

  // Identidade do respondente vem do TOKEN, nunca do corpo (auditoria 2026-08, lote 2 · L2-3).
  // `respondent_id` do corpo é aceito e IGNORADO — bundle antigo em cache não quebra.
  const authUser = await getRequestUser(req)
  const trustedRespondentId = authUser?.id ?? null
  // TETO DO FAN-OUT DE EVENTOS (auditoria 2026-08, lote 2 · L2-6).
  //
  // Este array era aceito sem teto de quantidade, sem teto de tamanho, sem dedup e sem
  // whitelist — e mais abaixo (`:698-717`) vira UM `sendMetaCAPIEvent` por elemento, todos
  // disparados no mesmo tick. Como `/api/responses` é anônimo, tem CORS `*` por desenho e é
  // isento do check de Origin no middleware, um único POST podia gerar milhares de chamadas
  // concorrentes à Meta — com o token e o pixel GLOBAIS da plataforma, não os do cliente.
  //
  // O filtro certo (`isRecordableMetaEvent`) já existia, mas rodava só no NAVEGADOR
  // (form-player.tsx:760-761) — ou seja, protegia o usuário honesto e ninguém mais.
  //
  // Máximo legítimo: 1 evento de conclusão + até 10 answerSets (`sanitizeAnswerSetEvents`
  // limita a 10 por formulário) + folga para o fbq. 25 cobre com margem.
  // O formato da coluna `meta_events` NÃO muda — dado já gravado (Sheets, CSV, PDF, e-mail)
  // depende dele.
  const MAX_META_EVENTS = 25
  const MAX_META_EVENT_LEN = 64 // nome de evento do Meta nunca passa disso
  const metaEvents = Array.isArray(body.meta_events)
    ? Array.from(
        new Set(
          body.meta_events
            .filter((e): e is string => typeof e === 'string')
            .map((e) => e.trim().slice(0, MAX_META_EVENT_LEN))
            .filter(isRecordableMetaEvent)
        )
      ).slice(0, MAX_META_EVENTS)
    : []
  const utmData = {
    utm_source: typeof body.utm_source === 'string' ? body.utm_source : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content : null,
  }
  // Campos ocultos via URL — re-sanitizados no servidor (fail-open: inválido
  // é descartado, nunca rejeita o submit). null quando não sobra nada.
  const urlParams = sanitizeUrlParams(body.url_params)

  // Honeypot: if _hp_ field is filled, silently accept but don't save (bot trap)
  if (body._hp_ && String(body._hp_).length > 0) {
    return NextResponse.json(
      { response_id: 'ok', completed: true },
      { status: 201, headers: CORS_HEADERS }
    )
  }

  // Bug #9: Sanitize answers
  let answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined

  // OBSERVABILIDADE da limpeza (auditoria 2026-08, lote 5).
  //
  // Até aqui a destruição era 100% invisível: nenhum log, nenhum erro, nenhuma métrica. Foi por
  // isso que `<joao@empresa.com>` virando string vazia sobreviveu tanto tempo — não havia como
  // saber que estava acontecendo. Agora fica um sinal, SEM o conteúdo (é resposta de lead: PII).
  //
  // Amostrado a ~5% de propósito: com a regra apertada a alteração legítima passou a ser rara,
  // mas um formulário que colete HTML de verdade geraria uma linha por resposta, e log que vira
  // ruído deixa de ser lido.
  if (answers && Math.random() < 0.05) {
    try {
      const antes = JSON.stringify(body.answers ?? {}).length
      const depois = JSON.stringify(answers).length
      if (antes !== depois) {
        console.warn('[sanitize] valor alterado na limpeza (amostra 5%)', {
          formId: body.form_id, bytesAntes: antes, bytesDepois: depois,
        })
      }
    } catch { /* medição nunca pode derrubar o submit */ }
  }

  if (!form_id) {
    return NextResponse.json({ error: 'ID do formulário é obrigatório' }, { status: 400, headers: CORS_HEADERS })
  }

  // Validate form_id is UUID format (prevents probing)
  if (typeof form_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form_id)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  // Limit number of answer keys to prevent abuse
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return NextResponse.json({ error: 'Número de respostas excede o limite' }, { status: 400, headers: CORS_HEADERS })
  }

  // Verificar se o formulário existe e está publicado
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, title, questions, status, user_id, webhook_url, is_closed, paused, notify_email_enabled, notify_email, notify_owner_enabled, google_sheets_enabled, google_sheets_id')
    .eq('id', form_id as string)
    .eq('status', 'published')
    .single() as { data: { id: string; title: string | null; questions: Array<{ id: string; required?: boolean }>; status: string; user_id: string; webhook_url: string | null; is_closed: boolean; paused: boolean; notify_email_enabled: boolean; notify_email: string | null; notify_owner_enabled?: boolean | null; google_sheets_enabled: boolean; google_sheets_id: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado ou não publicado' }, { status: 404, headers: CORS_HEADERS })
  }

  // Verificar se o form está fechado
  if (form.is_closed) {
    return NextResponse.json(
      { error: 'Este formulário não está aceitando novas respostas.' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  // Verificar se o form está pausado (downgrade de plano)
  if (form.paused) {
    return NextResponse.json(
      { error: 'Este formulário está pausado porque o plano do criador expirou.' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  const formQuestions = (form.questions ?? []) as QuestionConfig[]
  const { data: ownerProfile, error: ownerProfileError } = await supabase
    .from('profiles')
    .select('plan, email, plan_expires_at')
    .eq('id', form.user_id)
    .single() as { data: { plan: string | null; email: string | null; plan_expires_at: string | null } | null; error: unknown }
  if (ownerProfileError || !ownerProfile) {
    logError('[responses] falha ao ler plano do dono — submit preservado, sem poda fail-open/fail-free', ownerProfileError, {
      formId: form_id,
      ownerId: form.user_id,
    })
    return NextResponse.json(
      { error: 'Não foi possível validar o plano do formulário. Tente novamente.' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
  const ownerPlan = getEffectivePlan(ownerProfile)
  const ownerPlanConfig = PLANS[ownerPlan]
  const effectiveQuestions = filterQuestionsByPlan(formQuestions, ownerPlan)

  // Remove chaves de perguntas que não existem mais no form ou que o plano do
  // dono não permite mais (ex.: downgrade). Antes, qualquer chave órfã
  // bloqueava o submit inteiro com "Pergunta desconhecida".
  const { pruned: prunedAnswers, removedKeys } = pruneOrphanAnswers(
    effectiveQuestions,
    answers as Record<string, unknown>
  )
  if (removedKeys.length > 0) {
    console.warn('[responses] unavailable answer keys discarded', { form_id, removedKeys })
  }
  answers = prunedAnswers

  // Poda por LÓGICA CONDICIONAL/saltos (hardening 2026-07-01): descarta respostas de
  // perguntas fora do caminho percorrível (ramo escondido, troca de resposta no meio,
  // POST direto preenchendo campo oculto). Mesma semântica do isResponseComplete
  // (buildQuestionPath) → não cria 422 novo pra submit legítimo.
  const { pruned: onPathAnswers, removedKeys: offPathKeys } = pruneOffPathAnswers(
    effectiveQuestions,
    answers
  )
  if (offPathKeys.length > 0) {
    console.warn('[responses] off-path answer keys discarded', { form_id, offPathKeys })
  }
  answers = onPathAnswers

  // last_question_answered só persiste se apontar pra pergunta EXISTENTE do form
  // (Codex P3 2026-07-01 — evita referência pendurada a pergunta podada/deletada).
  const lastQuestionAnswered =
    typeof last_question_answered === 'string' && effectiveQuestions.some((q) => q.id === last_question_answered)
      ? last_question_answered
      : null

  // Se o respondente enviou chaves mas TODAS foram podadas (órfãs, bloqueadas
  // pelo plano do dono ou fora do caminho), não há nada válido para salvar —
  // rejeita ANTES de consumir cota. Sem isso, um POST direto só com campos
  // indisponíveis criaria uma resposta vazia e queimaria um slot do limite
  // mensal. Submit legítimo de form todo-opcional (sem chaves removidas) não cai aqui.
  if (Object.keys(answers).length === 0 && (removedKeys.length > 0 || offPathKeys.length > 0)) {
    return NextResponse.json(
      { error: 'Nenhuma resposta válida para salvar' },
      { status: 422, headers: CORS_HEADERS }
    )
  }

  // B16b: Validação backend por tipo de campo
  const fieldErrors = validateAllAnswers(
    effectiveQuestions,
    answers
  )
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      { error: 'Dados inválidos', field_errors: fieldErrors },
      { status: 422, headers: CORS_HEADERS }
    )
  }

  // Bug #5: Auto-detect completed based on required questions
  const completed = isResponseComplete(answers, effectiveQuestions)

  // Resolve primeiro o alvo de UPDATE (se houver) e a autorização sobre ele;
  // só depois o limite de respostas — um UPDATE não consome cota nova.
  let existingResponseId: string | null = req.headers.get('x-response-id')
  // A1 (auditoria 2026-06-10): prova de posse da parcial anônima.
  const partialToken = req.headers.get('x-partial-token')
    || (typeof body.partial_token === 'string' ? body.partial_token : null)
  // Session key (fix duplicatas 2026-07-08): bearer secret da tentativa de
  // preenchimento — faz o submit convergir pra parcial criada por sendBeacon,
  // cuja resposta (response_id/token) o cliente nunca conseguiu ler.
  const rawSessionKey = req.headers.get('x-partial-session')
    || (typeof body.partial_session === 'string' ? body.partial_session : null)
  const sessionHash = rawSessionKey !== null && isValidSessionKey(rawSessionKey)
    ? hashSessionKey(rawSessionKey)
    : null
  let existingResponse: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null = null
  if (existingResponseId) {
    // P0-2: Verify ownership — respondent_id from cookie must match the response's respondent_id
    // Fetch the existing response to check ownership
    const { data: fetched } = await supabase
      .from('responses')
      .select('id, respondent_id, completed, sheets_row_index')
      .eq('id', existingResponseId)
      .eq('form_id', form_id as string)
      .single() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null; error: unknown }

    if (!fetched) {
      return NextResponse.json({ error: 'Resposta não encontrada' }, { status: 404, headers: CORS_HEADERS })
    }

    // Há dois caminhos legítimos de UPDATE:
    //  (a) Autenticado: a row tem respondent_id e bate com o cookie/header do
    //      lado do cliente — fluxo de partial-response Plus+ pra logados.
    //  (b) Anônimo partial→final: a row foi criada por /api/responses/partial
    //      sem respondent_id (anônima), ainda não foi finalizada E o cliente
    //      apresenta o partial_token emitido na criação (A1). O id sozinho
    //      não autoriza mais — UUIDs podem vazar via logs/Sheets/webhooks.
    // IDENTIDADE VEM DO TOKEN, NUNCA DO CORPO (auditoria 2026-08, lote 2 · L2-3).
    //
    // Antes: `bodyRespondentId = body.respondent_id` — um anônimo mandava no corpo o UUID de
    // outro usuário e passava como "dono" da linha, finalizando resposta alheia e disparando
    // e-mail, WhatsApp, Sheets, webhook e CAPI com dados adulterados. O UUID do dono, aliás,
    // vaza no path do upload assinado.
    //
    // Agora a prova é o Bearer no header — que o player já envia (`form-player.tsx`) e que
    // viaja cross-origin, ao contrário do cookie (o player roda embedado e em domínio de
    // cliente). O `respondent_id` do corpo é IGNORADO, não rejeitado: bundle antigo em cache
    // continua enviando e não quebra.
    const isAnonymousPartialUpgrade =
      fetched.respondent_id === null &&
      fetched.completed === false &&
      verifyPartialToken(partialToken, existingResponseId)
    const isAuthenticatedOwner =
      !!fetched.respondent_id && fetched.respondent_id === trustedRespondentId

    // Curto-circuito de IDEMPOTÊNCIA — critério deliberadamente mais FROUXO que o de escrita.
    //
    // Escrever exige prova (token). Mas este ramo não escreve nada: só responde "já concluída"
    // e evita repetir e-mail/Sheets/CAPI/webhook. Aceitar aqui o `respondent_id` do corpo como
    // sinal legado é seguro (nenhum efeito colateral, e quem chama já conhecia o id da linha) e
    // evita um problema pior: sem ele, um bundle ANTIGO em cache que reenviasse cairia na
    // degradação abaixo e criaria uma SEGUNDA resposta completa — lead duplicado, e-mail
    // duplicado, linha duplicada no Sheets do cliente. (auditoria 2026-08, lote 2 · L2-3)
    const legacyBodyOwnerMatch =
      !!fetched.respondent_id &&
      typeof respondent_id === 'string' &&
      fetched.respondent_id === respondent_id
    if ((isAuthenticatedOwner || legacyBodyOwnerMatch) && fetched.completed === true) {
      // P1-4 (auditoria Codex 2026-07-23): resubmissão AUTENTICADA de resposta
      // já finalizada repetia e-mail/Sheets/CAPI/webhook a cada replay. Mesmo
      // tratamento idempotente do caminho anônimo: 200 already_completed, sem
      // UPDATE e sem side effects.
      return NextResponse.json(
        { response_id: fetched.id, completed: true, already_completed: true },
        { status: 200, headers: CORS_HEADERS }
      )
    }
    if (isAnonymousPartialUpgrade || isAuthenticatedOwner) {
      existingResponse = fetched
    } else if (
      fetched.respondent_id === null &&
      fetched.completed === true &&
      verifyPartialToken(partialToken, existingResponseId)
    ) {
      // Idempotência (achado Codex 2026-07-08): submit repetido da MESMA
      // tentativa via id+token — a row já foi completada pelo primeiro submit.
      // Antes caía no 403; agora responde sucesso sem repetir side effects.
      return NextResponse.json(
        { response_id: fetched.id, completed: true, already_completed: true },
        { status: 200, headers: CORS_HEADERS }
      )
    } else if (fetched.respondent_id === null && fetched.completed === false) {
      // Parcial anônima sem token válido (cliente antigo em voo ou id forjado):
      // não sobrescreve — degrada para criar uma resposta nova. Não perde lead
      // legítimo e não permite corromper a resposta de terceiros.
      existingResponseId = null
    } else {
      // DEGRADA em vez de recusar (auditoria 2026-08, lote 2 · L2-3).
      //
      // Chega aqui quem aponta para uma linha que não conseguiu provar ser sua. Antes era 403,
      // e o player NÃO tem retry: o respondente perdia o envio inteiro. Com a identidade agora
      // vindo do token, um bundle ANTIGO em cache (que manda só o uid no corpo, sem header)
      // cairia exatamente aqui — ou seja, endurecer sem degradar transformaria a correção de
      // segurança em perda de lead legítimo.
      //
      // Criar resposta nova é seguro nos dois sentidos: não sobrescreve linha de terceiro e
      // não descarta o que a pessoa preencheu.
      logWarn('[responses] posse da linha não comprovada — criando resposta nova', {
        formId: form_id, responseId: existingResponseId, autenticado: !!trustedRespondentId,
      })
      existingResponseId = null
    }
  }

  // Adoção por session key (fix 2026-07-08): sem id+token, mas com a key da
  // sessão — a posse da key prova a posse da parcial (mesma força do token).
  if (!existingResponseId && sessionHash) {
    const { data: bySession } = await supabase
      .from('responses')
      .select('id, respondent_id, completed, sheets_row_index')
      .eq('form_id', form_id as string)
      .eq('partial_session_hash', sessionHash)
      .maybeSingle() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null; error: unknown }
    if (bySession) {
      if (bySession.completed) {
        // Submit repetido da MESMA tentativa (double-click/retry): idempotente —
        // não cria response nova, não consome cota, não repete side effects.
        console.warn('[responses] submit repetido da mesma session — resposta idempotente', {
          formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: bySession.id,
        })
        return NextResponse.json(
          { response_id: bySession.id, completed: true, already_completed: true },
          { status: 200, headers: CORS_HEADERS }
        )
      }
      if (bySession.respondent_id === null) {
        console.log('[responses] submit adotou parcial via session key', {
          formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: bySession.id,
        })
        existingResponseId = bySession.id
        existingResponse = bySession
      }
    }
  }

  // Primeiro converge a tentativa para uma response_id. A cota é cobrada
  // DEPOIS, por response_id, e antes de promover completed=false -> true.
  // Assim parcial, token, session key, double-click e corrida 23505 compartilham
  // a mesma chave idempotente no banco.
  let responseId: string
  let responseMetaEvents: string[] = []
  // Horário PERSISTIDO da resposta — alimenta o e-mail de notificação.
  let responseSubmittedAt: string | null = null
  let existingSheetsRowIndex: number | null = null
  let effectiveUrlParams: Record<string, string> | null = urlParams
  // true só quando o submit criou response NOVA (sem adotar parcial) — alimenta
  // o detector passivo de duplicatas (Fase 3 em avaliação; log-only).
  let createdFresh = false

  if (existingResponseId && existingResponse) {
    responseId = existingResponseId
    existingSheetsRowIndex = existingResponse.sheets_row_index ?? null
  } else {
    const { data: newResponse, error: insertError } = await supabase
      .from('responses')
      // partial_session_hash no INSERT: se um handshake/beacon da mesma sessão
      // correr em paralelo, o índice único faz um dos dois perder (23505) e
      // adotar a row do outro — o banco garante a convergência.
      // Mesmo um submit completo nasce como parcial. A promoção para completed
      // só acontece depois da reserva idempotente de cota.
      .insert({ form_id: form_id as string, answers: answers as Record<string, import('@/lib/database.types').Json>, meta_events: metaEvents, completed: false, last_question_answered: lastQuestionAnswered, respondent_id: trustedRespondentId, ...utmData, url_params: urlParams, ...(sessionHash ? { partial_session_hash: sessionHash } : {}) } as ResponseInsert)
      // submitted_at volta do INSERT porque é o horário PERSISTIDO do lead — o
      // e-mail mostra ele, nunca o relógio do envio (numa retentativa, o aviso
      // apresentaria a hora do aviso como se fosse a hora do lead).
      .select('id, meta_events, sheets_row_index, url_params, submitted_at')
      .single() as { data: { id: string; meta_events?: string[]; submitted_at?: string } | null; error: { message: string; code?: string } | null }

    if (insertError || !newResponse) {
      // 23505 no índice (form_id, partial_session_hash): a parcial da MESMA
      // sessão nasceu durante este submit (handshake/beacon em voo). Adota-a
      // e completa por cima, como no caminho normal de upgrade.
      if (insertError?.code === '23505' && sessionHash) {
        const { data: raced } = await supabase
          .from('responses')
          .select('id, respondent_id, completed, sheets_row_index, url_params')
          .eq('form_id', form_id as string)
          .eq('partial_session_hash', sessionHash)
          .maybeSingle() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null; url_params?: Record<string, string> | null } | null; error: unknown }
        if (raced?.completed) {
          return NextResponse.json(
            { response_id: raced.id, completed: true, already_completed: true },
            { status: 200, headers: CORS_HEADERS }
          )
        }
        if (raced && raced.respondent_id === null) {
          console.log('[responses] corrida de INSERT no submit resolvida por adoção (23505)', {
            formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: raced.id,
          })
          existingResponseId = raced.id
          existingResponse = raced
          responseId = raced.id
          existingSheetsRowIndex = raced.sheets_row_index ?? null
          effectiveUrlParams = urlParams ?? sanitizeUrlParams(raced.url_params) ?? null
        } else {
          logError('Insert 23505 sem parcial adotável:', insertError, { form_id })
          return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
        }
      } else {
        // PII fora dos logs (P3): respondent_id identifica o usuário — loga só presença.
        logError('Failed to insert response:', insertError, { form_id: form_id, has_respondent: Boolean(respondent_id) })
        return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
      }
    } else {
      responseId = newResponse.id
      responseMetaEvents = Array.isArray(newResponse.meta_events) ? newResponse.meta_events : []
      responseSubmittedAt = newResponse.submitted_at ?? null
      createdFresh = true
    }
  }

  if (completed) {
    const limitCheck = await checkAndIncrementResponseCount(form.user_id, responseId)
    if (limitCheck.unavailable) {
      return NextResponse.json(
        {
          error: 'Não foi possível validar a cota agora. Tente novamente.',
          response_id: responseId,
          retryable: true,
          ...(!existingResponseId && !trustedRespondentId
            ? { partial_token: signPartialToken(responseId) }
            : {}),
        },
        { status: 503, headers: CORS_HEADERS }
      )
    }
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          // Texto NEUTRO (alinhamento Free, itens 3 e 8): quem lê isto é o LEAD, não o dono.
          // Antes dizia "Limite de respostas atingido para o plano atual" — a paciente descobria
          // que o dentista dela estava com a conta atrasada. O caminho normal nem chega aqui (a
          // página já mostra a tela de indisponível ao abrir); isto cobre envio direto e a corrida
          // de quem estava com o formulário aberto quando a cota virou.
          error: 'Este formulário não está aceitando respostas no momento.',
          // `plan`/`limit` continuam no corpo para o painel e a telemetria — o player mostra só
          // o `error`, e nenhum dos dois aparece na tela do lead.
          plan: limitCheck.plan,
          limit: limitCheck.limit,
          response_id: responseId,
        },
        { status: 429, headers: CORS_HEADERS }
      )
    }
    if (limitCheck.nearLimit) {
      sendNearLimitAlert(form.user_id, limitCheck.usage, limitCheck.limit, limitCheck.plan)
        .catch((err) => logError('Failed to send limit alert', err))
    }
  }

  // Atualiza tanto parciais adotadas quanto a row recém-criada. O CAS garante
  // que só um submit promove a resposta e executa os side effects.
  if (existingResponseId || completed) {
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({ answers, meta_events: metaEvents, completed, last_question_answered: lastQuestionAnswered, ...utmData, ...(urlParams ? { url_params: urlParams } : {}) } as ResponseUpdate)
      .eq('id', responseId)
      .eq('form_id', form_id as string)
      .eq('completed', false)
      .select('id, meta_events, sheets_row_index, url_params, submitted_at')
      .single() as { data: { id: string; meta_events?: string[]; sheets_row_index: number | null; url_params?: Record<string, string> | null; submitted_at?: string } | null; error: unknown }

    if (updateError || !updated) {
      const { data: check } = await supabase
        .from('responses')
        .select('id, completed')
        .eq('id', responseId)
        .maybeSingle() as { data: { id: string; completed: boolean } | null; error: unknown }
      if (check?.completed) {
        console.warn('[responses] corrida de dupla submissão — resposta e cota idempotentes', { formId: form_id, responseId: check.id })
        return NextResponse.json(
          { response_id: check.id, completed: true, already_completed: true },
          { status: 200, headers: CORS_HEADERS }
        )
      }
      logError('Failed to update response after quota claim:', updateError, { form_id, responseId })
      return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
    }

    responseMetaEvents = Array.isArray(updated.meta_events) ? updated.meta_events : []
    responseSubmittedAt = updated.submitted_at ?? responseSubmittedAt
    existingSheetsRowIndex = updated.sheets_row_index ?? existingSheetsRowIndex
    effectiveUrlParams = urlParams ?? sanitizeUrlParams(updated.url_params) ?? effectiveUrlParams
  }

  if (existingResponseId) {
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  }

  // Inserir answer_items normalizados para analytics
  // Serializa tipos complexos (address, file_upload, etc.) como JSON
  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: responseId,
    question_id: questionId,
    value: serializeAnswerValue(value),
  }))

  if (answerItems.length > 0) {
    const { error: itemsError } = await supabase.from('answer_items').insert(answerItems as AnswerItemInsert[])
    if (itemsError) logError('Failed to insert answer_items:', itemsError)
  }

  // Notificar por email e disparar integrações se resposta completa.
  // Importante: em serverless, side-effects fire-and-forget podem ser abortados
  // quando a resposta HTTP termina. Por isso acumulamos promises e aguardamos.
  const postSubmitTasks: Promise<unknown>[] = []
  if (completed) {
    // Notificação por e-mail — CONSTRUTOR ÚNICO (2026-07-30). Antes existiam
    // dois e-mails divergentes para a mesma resposta (lib/resend.ts para o dono,
    // lib/notify.ts para o endereço extra), com conteúdo, identidade visual,
    // idempotência e retry diferentes. Agora: um modelo, um conteúdo, um envio
    // POR DESTINATÁRIO.
    //
    // Regra de negócio preservada: o e-mail do DONO é notificado sempre que o
    // plano permite; `notify_email_enabled` só ACRESCENTA um segundo
    // destinatário. A dedup agora normaliza caixa/espaços.
    if (ownerPlanConfig?.emailNotifications) {
      const emailRecipients = resolveEmailRecipients({
        ownerEmail: ownerProfile?.email,
        notifyEmail: form.notify_email,
        notifyEmailEnabled: form.notify_email_enabled,
        notifyOwnerEnabled: form.notify_owner_enabled,
      })

      if (emailRecipients.length > 0) {
        console.log('[responses] sending lead email notification', {
          formId: form_id, responseId, ownerPlan,
          recipientRoles: emailRecipients.map((r) => r.role),
        })
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
        // Modelo montado no caminho da requisição, de propósito: é barato e não
        // faz I/O (§3.5 — não existe fila durável para e-mail; não piorar).
        const emailModel = buildNotificationModel({
          formId: form_id as string,
          responseId,
          responseData: answers as Record<string, unknown>,
          form: {
            id: form.id,
            title: form.title,
            user_id: form.user_id,
            questions: effectiveQuestions as Array<{ id: string; title?: string; type?: string }>,
          },
          appUrl,
          // Horário PERSISTIDO. O fallback só existe porque o banco pode não
          // devolver a coluna (corrida de adoção 23505); nesse caso o instante
          // atual é a melhor aproximação disponível.
          eventAt: responseSubmittedAt ?? new Date().toISOString(),
          metaEvents: responseMetaEvents,
          urlParams: effectiveUrlParams,
          utm: utmData,
        })
        postSubmitTasks.push(
          sendNewResponseEmails({ model: emailModel, recipients: emailRecipients })
            .then(async (outcomes) => {
              for (const outcome of outcomes) {
                if (outcome.error) {
                  logError('Lead email rejected', undefined, {
                    formId: form_id, responseId, ownerPlan, role: outcome.role, error: outcome.error,
                  })
                  // D-05: falha do transporte deixa de ser perda definitiva. Enfileira REFERÊNCIA
                  // (form/resposta/papel) — o e-mail é remontado do banco no reenvio, então não
                  // há dado do lead duplicado aqui. Nunca bloqueia o pós-submit.
                  await enfileirarReenvio({
                    kind: 'new-response',
                    formId: form_id as string,
                    responseId,
                    role: outcome.role as 'owner' | 'form_email',
                    erro: outcome.error,
                  }).catch(() => {})
                }
              }
            })
            .catch((err) => logError('Failed to send lead email notification', err))
        )
      } else {
        console.log('[responses] lead email notification skipped — sem destinatário', {
          formId: form_id, responseId, ownerPlan,
          hasOwnerEmail: Boolean(ownerProfile?.email),
          notifyEmailEnabled: form.notify_email_enabled,
          hasNotifyEmail: Boolean(form.notify_email),
        })
      }
    } else {
      console.log('[responses] lead email notification skipped — plano', {
        formId: form_id, responseId, ownerPlan,
        planAllowsEmailNotifications: Boolean(ownerPlanConfig?.emailNotifications),
      })
    }

    // WhatsApp notification — delegated to sendWhatsAppOnFormResponse which checks form_whatsapp_settings
    // Autorização por CAPACIDADE do dono do formulário, NÃO por plano
    // (2026-07-30): a feature saiu da vitrine e vale só para a lista de UUIDs em
    // `lib/whatsapp-capability`. Barrar aqui evita chamada inútil ao endpoint
    // interno em toda submissão da base; o SINK barra de novo (defesa dupla).
    {
      if (canUseLeadWhatsApp(form.user_id)) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        postSubmitTasks.push(
          sendWhatsAppOnFormResponse({
            formId: form_id as string,
            responseId,
            responseData: answers as Record<string, unknown>,
            meta_events: responseMetaEvents,
            urlParams: effectiveUrlParams,
            utm: utmData,
            form: {
              id: form.id,
              title: form.title,
              user_id: form.user_id,
              questions: effectiveQuestions as Array<{ id: string; title?: string; type?: string }>,
            },
            appUrl,
          }).catch((err) => logError('Failed to send WhatsApp notification', err))
        )
      }
    }

    if (form.google_sheets_enabled && form.google_sheets_id && ownerPlanConfig?.googleSheets) {
      const sheetQuestions = effectiveQuestions as Array<{ id: string; title: string }>
      const fieldLabels = sheetQuestions.map((q) => q.title || 'Sem título')
      const questionIdToLabel: Record<string, string> = {}
      for (const q of sheetQuestions) {
        questionIdToLabel[q.id] = q.title || 'Sem título'
      }
      // Se a row já existe no Sheets (criada por /api/responses/partial), faz
      // UPDATE direto pela rowIndex e marca status=Completo — evita duplicar
      // a linha no submit final.
      const spreadsheetId = form.google_sheets_id
      const sheetsRowIndex = existingSheetsRowIndex
      postSubmitTasks.push(
        (async () => {
          const result = await upsertSubmission({
            spreadsheetId,
            fieldLabels,
            // meta_events junto: é de onde a coluna meta_events da planilha lê
            // (sem isso ela fica sempre vazia — gap corrigido em 2026-07-07).
            answers: { ...(answers as Record<string, unknown>), meta_events: responseMetaEvents },
            questionIdToLabel,
            utmData,
            urlParams: effectiveUrlParams,
            responseId,
            status: 'Completo',
            rowIndex: sheetsRowIndex,
          })
          // Se foi append (sem rowIndex prévio), persiste o novo índice
          if (result.rowIndex && result.rowIndex !== sheetsRowIndex) {
            await supabase
              .from('responses')
              .update({ sheets_row_index: result.rowIndex })
              .eq('id', responseId)
          }
        })().catch((e) => logError('Google Sheets sync failed:', e))
      )
    }

    // Meta Conversions API (CAPI) — server-side Lead event (Plus+ only)
    if (ownerPlanConfig?.pixels && metaEvents.length > 0) {
      const pii = extractPIIFromAnswers(
        answers as Record<string, unknown>,
        effectiveQuestions as Array<{ id: string; type?: string; title?: string; fields?: Array<{ id: string; ref?: string }> }>
      )
      const userAgent = req.headers.get('user-agent') ?? undefined
      const referer = req.headers.get('referer') ?? undefined
      for (const eventId of metaEvents) {
        postSubmitTasks.push(
          sendMetaCAPIEvent({
            ...pii,
            ip,
            userAgent,
            eventId,
            formTitle: form.title ?? undefined,
            eventSourceUrl: referer,
          }).catch((err) => logError('Failed to send Meta CAPI event', err))
        )
      }
    }

    // Webhook externo configurado pelo usuário — feature gated
    if (form.webhook_url && ownerPlanConfig?.webhooks) {
      // Enriquecer payload com metadata dos campos + lead canônico
      const fields = effectiveQuestions.map(q => ({
        question_id: q.id,
        type: q.type,
        title: q.title,
      }))
      const lead = extractLead({
        responseData: answers as Record<string, unknown>,
        questions: effectiveQuestions.map(q => ({ id: q.id, title: q.title, type: q.type })),
      })
      postSubmitTasks.push(
        dispatchWebhook({
          webhookUrl: form.webhook_url,
          formId: form_id as string,
          responseId,
          responseData: answers as Record<string, unknown>,
          fields,
          lead,
          urlParams: effectiveUrlParams,
          utm: utmData,
          // L3-1 (auditoria 2026-08, lote 3): a fila morta, o template de e-mail, a tabela e a RLS
          // do aviso "seu webhook parou" já existiam — e NUNCA dispararam, porque nenhum chamador
          // passava `ownerEmail`. Funcionalidade pronta e morta desde que foi escrita: o CRM do
          // cliente caía e ele só descobria pela ausência de leads, dias depois.
          ownerEmail: ownerProfile?.email ?? undefined,
        }).catch((err) => logError('Failed to dispatch webhook', err))
      )
    }
  }

  if (postSubmitTasks.length > 0) {
    // Auditoria Codex 2026-07-23: o submit do LEAD esperava as notificações
    // (WhatsApp podia segurar até 30s). `after()` devolve a resposta JÁ e roda
    // as tarefas depois, sem risco de freeze na Vercel. Fallback: fora de um
    // request scope (testes), `after` lança — aí degrada pro comportamento antigo.
    try {
      after(async () => { await Promise.allSettled(postSubmitTasks) })
    } catch (err) {
      // Fallback esperado só FORA de request scope (vitest). Qualquer outra
      // falha de after() é anômala — loga antes de degradar pro modo síncrono
      // (auditoria Codex 2026-07-23: catch silencioso ocultava erro real).
      logError('[responses] after() indisponível — degradando para pós-submit síncrono', err)
      await Promise.allSettled(postSubmitTasks)
    }
  }

  // Detector PASSIVO de duplicatas (Fase 3 em avaliação — auditoria Codex
  // 2026-07-08): quando o submit criou response NOVA e completa, loga se existe
  // parcial recente do mesmo form com identidade (e-mail/telefone) coincidente.
  // SÓ LOG — nenhuma ação. Mede a duplicação residual (storage perdido/webview)
  // pra decidir com número se a reconciliação da Fase 3 vale o risco.
  if (createdFresh && completed) {
    await logPossibleDuplicatePartial(supabase, form_id as string, responseId, effectiveQuestions, answers as Record<string, unknown>, urlParams)
  }

  // Resposta anônima incompleta: devolve a prova de posse (A1) para o cliente
  // poder completar via upsert depois — o response_id sozinho não autoriza mais.
  const issuePartialToken = !completed && !trustedRespondentId
  return NextResponse.json(
    {
      response_id: responseId,
      completed,
      ...(issuePartialToken ? { partial_token: signPartialToken(responseId) } : {}),
    },
    {
      status: existingResponseId ? 200 : 201,
      headers: {
        ...CORS_HEADERS,
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    }
  )
  } catch (err) {
    logError('POST /api/responses crashed:', err)
    return NextResponse.json({ error: 'Erro interno do servidor', detail: err instanceof Error ? err.message : String(err) }, { status: 500, headers: CORS_HEADERS })
  }
}

// GET /api/responses — list responses for authenticated user
// Note: Uses admin client to bypass RLS, but auth is enforced via getRequestUser()
// No CORS headers on GET — this is an authenticated dashboard endpoint, not public
export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // P1-5: Rate limit GET responses (60 req/min per user)
  const rlKey = `responses:get:${user.id}`
  const { allowed: rlAllowed } = await checkRateLimitAsync(rlKey, { maxAttempts: 60, windowMs: 60_000 })
  if (!rlAllowed) {
    return NextResponse.json({ error: 'Muitas requisições. Tente novamente mais tarde.' }, { status: 429 })
  }

  const url = new URL(req.url)
  const formId = url.searchParams.get('form_id')
  const page = parseInt(url.searchParams.get('page') ?? '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
  const offset = (page - 1) * limit

  // Validate that the form belongs to this user (if form_id provided)
  if (formId) {
    const { data: form } = await supabase
      .from('forms')
      .select('id')
      .eq('id', formId)
      .eq('user_id', user.id)
      .single()

    if (!form) {
      return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })
    }
  }

  let query = supabase
    .from('responses')
    .select('id, form_id, answers, meta_events, completed, submitted_at, last_question_answered, utm_source, utm_medium, utm_campaign, utm_term, utm_content', { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (formId) {
    query = query.eq('form_id', formId)
  } else {
    // Get all responses for forms owned by this user
    const { data: forms } = await supabase
      .from('forms')
      .select('id')
      .eq('user_id', user.id)

    const formIds = (forms ?? []).map((f: { id: string }) => f.id)
    if (formIds.length === 0) {
      return NextResponse.json({ responses: [], pagination: { page, limit, total: 0, total_pages: 0 } })
    }
    query = query.in('form_id', formIds)
  }

  const { data: responses, error, count } = await query

  if (error) {
    return NextResponse.json({ error: 'Falha ao buscar respostas' }, { status: 500 })
  }

  return NextResponse.json({
    responses,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  })
}

// ── Detector passivo de duplicatas (log-only) ────────────────────────────────
// Fase 3 (reconciliação por identidade) está EM AVALIAÇÃO — decisão da
// auditoria: medir a duplicação residual pós-Fase 1 antes de implementar.
// Este detector NUNCA age: identidade identifica, não prova posse.
async function logPossibleDuplicatePartial(
  supabase: ReturnType<typeof createAdminClient>,
  formId: string,
  newResponseId: string,
  questions: QuestionConfig[],
  answers: Record<string, unknown>,
  urlParams: Record<string, string> | null
): Promise<void> {
  try {
    const newIdentity = extractIdentity(questions, answers, urlParams)
    if (!newIdentity.email && !newIdentity.phone) return

    // ⚠️ ESTE DETECTOR NUNCA MEDIU NADA (auditoria 2026-08, lote 5).
    //
    // A consulta pedia `created_at`, coluna que a tabela `responses` NÃO TEM — o PostgREST recusa
    // a consulta inteira nesse caso. `data` vinha `null`, o `error` era descartado no destructuring
    // e a função saía em silêncio no `if (!partials?.length) return`. Ou seja: desde que foi
    // escrito, um instrumento de MEDIÇÃO vinha reportando "nenhuma duplicata" sem nunca ter olhado.
    //
    // Para uma resposta parcial `submitted_at` é nulo (ela não foi enviada), então a coluna certa
    // aqui é `last_activity_at` — que é justamente o que se quer medir: "parcial ativa há pouco".
    //
    // 📌 A PRIMEIRA SEMANA DESTE LOG É LINHA DE BASE, NÃO ALARME. Ele vai começar a falar agora;
    // um pico de `[reconcile-detector]` não significa que a duplicação piorou, significa que o
    // detector acordou. Só compare janelas DEPOIS de 07/08/2026.
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const { data: partials, error: partialsErr } = await supabase
      .from('responses')
      .select('id, answers, url_params, last_activity_at')
      .eq('form_id', formId)
      .eq('completed', false)
      .gte('last_activity_at', cutoff)
      .neq('id', newResponseId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(25) as { data: { id: string; answers: Record<string, unknown> | null; url_params?: Record<string, string> | null; last_activity_at: string | null }[] | null; error: { message?: string } | null }
    // O erro deixa de ser engolido: era ele que escondia a coluna inexistente.
    if (partialsErr) {
      console.warn('[reconcile-detector] consulta falhou — medição indisponível', { formId, erro: partialsErr.message })
      return
    }
    if (!partials?.length) return

    for (const p of partials) {
      const pIdentity = extractIdentity(questions, p.answers, sanitizeUrlParams(p.url_params))
      if (identitiesMatch(newIdentity, pIdentity)) {
        // Sem PII no log: só ids, o TIPO do campo que casou e a idade da parcial.
        console.warn('[reconcile-detector] parcial recente com identidade coincidente (log-only)', {
          formId,
          completedResponseId: newResponseId,
          partialResponseId: p.id,
          matchedOn: newIdentity.email && pIdentity.email === newIdentity.email ? 'email' : 'phone',
          partialAgeMin: p.last_activity_at
            ? Math.round((Date.now() - new Date(p.last_activity_at).getTime()) / 60000)
            : null,
        })
        return // primeiro match basta pra medição
      }
    }
  } catch (e) {
    logError('[reconcile-detector] failed', e, { formId })
  }
}
