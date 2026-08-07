import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plans'
import { filterQuestionsByPlan } from '@/lib/questions'
import { pruneOrphanAnswers, pruneOffPathAnswers, validateAllAnswers } from '@/lib/field-validators'
import type { QuestionConfig } from '@/lib/database.types'
import { sanitizeValue } from '@/lib/form-response-security'
import { log, logError } from '@/lib/logger'
import { checkPartialRateLimitAsync } from '@/lib/response-rate-limit'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/**
 * GET /api/forms/[id]/partial-response
 * Returns the current partial (incomplete) response for the authenticated user.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: formId } = await params

  if (!formId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createServiceRoleClient()

  // Verify form exists and is published
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, status')
    .eq('id', formId)
    .eq('status', 'published')
    .single()

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }

  // Check if form owner's plan supports partial responses
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', form.user_id)
    .single()

  const ownerPlan = getEffectivePlan(ownerProfile) as PlanName
  if (!PLANS[ownerPlan]?.partialResponses) {
    return NextResponse.json({ answers: null }, { status: 200, headers: CORS_HEADERS })
  }

  // Fetch the latest incomplete response for this user + form
  const { data: partial } = await supabase
    .from('responses')
    .select('id, answers, last_question_answered, submitted_at')
    .eq('form_id', formId)
    .eq('respondent_id', user.id)
    .eq('completed', false)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single()

  if (!partial) {
    return NextResponse.json({ answers: null }, { status: 200, headers: CORS_HEADERS })
  }

  log('Partial response loaded', { formId, responseId: partial.id, respondentId: user.id })

  return NextResponse.json(
    {
      response_id: partial.id,
      answers: partial.answers,
      last_question_answered: partial.last_question_answered,
      saved_at: partial.submitted_at,
    },
    { status: 200, headers: CORS_HEADERS }
  )
}

/**
 * PUT /api/forms/[id]/partial-response
 * Saves or updates a partial (incomplete) response for the authenticated user.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: formId } = await params

  if (!formId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // Orçamento PRÓPRIO dos parciais: 30/min por IP+form, mais teto global de 90/min por IP.
  //
  // NÃO usar `checkResponseRateLimitAsync`: aquele balde (`resp:${ip}`, 10/min) é do SUBMIT
  // FINAL. Compartilhá-lo fazia o autosave gastar o orçamento do próprio envio: ~10 perguntas
  // respondidas num ritmo normal esgotavam a janela e o `POST /api/responses` levava 429 — o
  // player não tem retry, então a resposta ficava `completed=false` e o lead virava "abandono".
  // Pior sob NAT (clínica, escola, evento, 4G): o autosave de um respondente derrubava o
  // submit de outro no mesmo IP.
  //
  // A correção já existia desde 08/07 no helper e foi aplicada só na rota gêmea anônima
  // (`/api/responses/partial`) — clássico drift entre irmãos. O comentário antigo aqui
  // prometia "30 req/min" que o código nunca implementou, o que camuflou o defeito contra
  // revisão. (auditoria 2026-08, lote 2 · L2-4)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rateCheck = await checkPartialRateLimitAsync(ip, formId)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  const supabase = createServiceRoleClient()

  // Verify form exists and is published
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, status, is_closed, paused, questions')
    .eq('id', formId)
    .eq('status', 'published')
    .single()

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }

  // `paused` também bloqueia (auditoria 2026-08, lote 2-bis · D2). As TRÊS rotas irmãs que
  // gravam resposta já checavam; esta nem lia a coluna. E `paused` NÃO equivale a "plano
  // expirou": `pauseFormsBeyondLimit` pausa os formulários EXCEDENTES num downgrade entre
  // planos pagos — o dono continua Plus, o gate de plano abaixo passa, e o autosave seguia
  // gravando num formulário que o painel anuncia como "não está recebendo novas respostas".
  // Essas linhas alimentavam os crons de lead abandonado (e-mail pago + WhatsApp).
  if (form.is_closed || form.paused) {
    return NextResponse.json({ error: 'Formulário indisponível' }, { status: 403, headers: CORS_HEADERS })
  }

  // Check if form owner's plan supports partial responses
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', form.user_id)
    .single()

  const ownerPlan = getEffectivePlan(ownerProfile) as PlanName
  if (!PLANS[ownerPlan]?.partialResponses) {
    return NextResponse.json(
      { error: 'Respostas parciais não disponíveis no plano atual' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  // Parse body
  let body: { answers?: Record<string, unknown>; last_question_answered?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { answers, last_question_answered } = body
  // Array também é typeof 'object' — rejeitar explicitamente (Codex P3 2026-07-01).
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const sanitizedAnswersRaw = sanitizeValue(answers) as Record<string, unknown>

  // Hardening 2026-07-01: este endpoint aceitava QUALQUER objeto `answers` sem poda.
  // Agora aplica as mesmas defesas do /api/responses/partial anônimo: descarta chave
  // órfã/bloqueada pelo plano e resposta fora do caminho da lógica condicional/saltos.
  const formQuestions = (form.questions ?? []) as QuestionConfig[]
  const effectiveQuestions = filterQuestionsByPlan(formQuestions, ownerPlan)
  const { pruned: knownAnswers, removedKeys: orphanKeys } = pruneOrphanAnswers(
    effectiveQuestions,
    sanitizedAnswersRaw
  )
  const { pruned: sanitizedAnswers, removedKeys: offPathKeys } = pruneOffPathAnswers(
    effectiveQuestions,
    knownAnswers
  )
  // Validação POR VALOR — a defesa que faltava (auditoria 2026-08, lote 2 · L2-2).
  //
  // As duas podas acima filtram CHAVE (pergunta órfã, resposta fora do caminho da lógica);
  // nenhuma olha o VALOR. As três rotas irmãs (`/api/responses`, `/api/responses/partial` e
  // `/api/v1/forms/[id]`) chamam `validateAllAnswers`; esta nunca chamou — mais um caso do
  // padrão sistêmico #5 (a correção foi aplicada nas irmãs e esta ficou para trás).
  //
  // O que isso abria: `validateFileUpload` (field-validators.ts:348-366) exige que a URL do
  // anexo comece com o prefixo público do bucket `form-uploads`. Sem passar por aqui, bastava
  // uma CONTA GRÁTIS para gravar um "anexo" apontando para o domínio do atacante no formulário
  // de outro cliente. O painel do dono renderiza o chip com botão "Baixar"
  // (responses-dashboard.tsx:299) — o DONO clica e vai parar no site do atacante. Phishing com
  // a marca do EidosForm contra o próprio cliente.
  //
  // DESCARTA a chave inválida e segue 200, como a irmã anônima — NÃO devolve 422: o autosave é
  // silencioso (form-player.tsx:585-620) e um 422 viraria "Falha ao salvar progresso" no meio
  // do preenchimento. O log abaixo torna o descarte observável.
  const valueErrors = validateAllAnswers(effectiveQuestions, sanitizedAnswers)
  const invalidIds = new Set(valueErrors.map((e) => e.questionId))
  const validAnswers: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sanitizedAnswers)) {
    if (!invalidIds.has(k)) validAnswers[k] = v
  }

  if (orphanKeys.length > 0 || offPathKeys.length > 0 || invalidIds.size > 0) {
    console.warn('[forms/partial-response] answer keys discarded', {
      formId, orphanKeys, offPathKeys, invalidKeys: [...invalidIds],
    })
  }
  if (Object.keys(validAnswers).length === 0) {
    // Nada válido pra salvar — não cria/atualiza linha com objeto vazio.
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }

  // last_question_answered só persiste se apontar pra pergunta EXISTENTE (Codex P3 2026-07-01).
  const lastQuestionOk =
    typeof last_question_answered === 'string' && effectiveQuestions.some((q) => q.id === last_question_answered)
      ? last_question_answered
      : null

  // Upsert: find existing incomplete response or create new one
  const { data: existing } = await supabase
    .from('responses')
    .select('id')
    .eq('form_id', formId)
    .eq('respondent_id', user.id)
    .eq('completed', false)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single()

  let responseId: string

  if (existing) {
    // P2-5 (2ª auditoria Codex): o UPDATE não era condicionado a completed=false.
    // Se o submit final entrasse entre o SELECT e este UPDATE, o autosave
    // sobrescrevia as respostas de uma resposta JÁ FINALIZADA e ainda bumpava
    // last_activity_at. Agora é compare-and-set.
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({
        answers: validAnswers as Record<string, import('@/lib/database.types').Json>,
        last_question_answered: lastQuestionOk,
        // Idem: relógio de atividade pro cron de lead abandonado.
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('completed', false)
      .select('id')
      .maybeSingle()

    if (updateError) {
      logError('Failed to update partial response', updateError, { formId, respondentId: user.id })
      return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
    }
    if (!updated) {
      // Zero linhas = a resposta foi finalizada nesse meio-tempo. Não é erro:
      // não há progresso a salvar num form já enviado.
      log('Partial autosave ignorado — resposta já finalizada', { formId, responseId: existing.id })
      return NextResponse.json(
        { response_id: existing.id, already_completed: true },
        { status: 200, headers: CORS_HEADERS }
      )
    }
    responseId = updated.id
  } else {
    const { data: created, error: insertError } = await supabase
      .from('responses')
      .insert({
        form_id: formId,
        respondent_id: user.id,
        answers: validAnswers as Record<string, import('@/lib/database.types').Json>,
        completed: false,
        last_question_answered: lastQuestionOk,
        last_activity_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !created) {
      // P2-5: dois PUTs simultâneos podiam AMBOS não achar parcial e inserir,
      // deixando DUAS rows incompletas — uma é completada e a outra vira falso
      // abandono. Com o índice único parcial (migration), o perdedor recebe
      // 23505 e adota a row do vencedor em vez de duplicar.
      if ((insertError as { code?: string } | null)?.code === '23505') {
        const { data: winner } = await supabase
          .from('responses')
          .select('id')
          .eq('form_id', formId)
          .eq('respondent_id', user.id)
          .eq('completed', false)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (winner) {
          log('Partial autosave adotou parcial concorrente (23505)', { formId, responseId: winner.id })
          return NextResponse.json(
            { response_id: winner.id },
            { status: 200, headers: CORS_HEADERS }
          )
        }
      }
      logError('Failed to create partial response', insertError, { formId, respondentId: user.id })
      return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
    }
    responseId = created.id
  }

  log('Partial response saved', { formId, responseId, respondentId: user.id })

  return NextResponse.json(
    { response_id: responseId, saved: true },
    { status: 200, headers: CORS_HEADERS }
  )
}
