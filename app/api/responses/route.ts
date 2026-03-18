import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkResponseLimit, incrementResponseCount } from '@/lib/plan-limits'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'

// POST /api/responses — submeter resposta (completa ou parcial)
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const body = await req.json()
  const { form_id, answers, completed = false, last_question_answered } = body

  if (!form_id) {
    return NextResponse.json({ error: 'form_id is required' }, { status: 400 })
  }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers must be an object' }, { status: 400 })
  }

  // Verificar se o formulário existe e está publicado
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, questions, status, user_id, webhook_url')
    .eq('id', form_id)
    .eq('status', 'published')
    .single() as { data: { id: string; questions: unknown[]; status: string; user_id: string; webhook_url: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Form not found or not published' }, { status: 404 })
  }

  // Checar limite de respostas do plano (apenas em novas respostas completas)
  const existingResponseId = req.headers.get('x-response-id')
  if (!existingResponseId && completed) {
    const limitCheck = await checkResponseLimit(form.user_id)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: 'Response limit reached for current plan', plan: limitCheck.plan, limit: limitCheck.limit },
        { status: 429 }
      )
    }
  }

  let responseId: string

  if (existingResponseId) {
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({ answers, completed, last_question_answered: last_question_answered ?? null } as never)
      .eq('id', existingResponseId)
      .eq('form_id', form_id)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    }

    responseId = updated.id
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  } else {
    const { data: newResponse, error: insertError } = await supabase
      .from('responses')
      .insert({ form_id, answers, completed, last_question_answered: last_question_answered ?? null } as never)
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (insertError || !newResponse) {
      return NextResponse.json({ error: (insertError as { message: string } | null)?.message || 'Failed to save response' }, { status: 500 })
    }

    responseId = newResponse.id
  }

  // Inserir answer_items normalizados para analytics
  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: responseId,
    question_id: questionId,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }))

  if (answerItems.length > 0) {
    const { error: itemsError } = await supabase.from('answer_items').insert(answerItems as never)
    if (itemsError) console.error('Failed to insert answer_items:', (itemsError as { message: string }).message)
  }

  // Notificar por email e disparar webhook se resposta completa
  if (completed) {
    // Incrementa contador de respostas do dono do form
    if (!existingResponseId) {
      await incrementResponseCount(form.user_id).catch(console.error)
    }

    // Email de notificação
    try {
      const { sendNewResponseNotification } = await import('@/lib/email')
      await sendNewResponseNotification(form_id, form.user_id, responseId)
    } catch (e) {
      console.error('Email notification failed:', e)
    }

    // Webhook externo configurado pelo usuário
    if (form.webhook_url) {
      dispatchWebhook({
        webhookUrl: form.webhook_url,
        formId: form_id,
        responseId,
        responseData: answers as Record<string, unknown>,
      }).catch(console.error) // fire-and-forget, não bloqueia resposta
    }
  }

  return NextResponse.json({ response_id: responseId }, { status: existingResponseId ? 200 : 201 })
}
