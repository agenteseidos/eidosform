import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plans'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id]/analytics
export async function GET(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verificar ownership
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, questions')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (formError || !form) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // P1 FIX: Feature gate — advanced analytics (abandonment, avg time) require Plus plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const userPlan = getEffectivePlan(profile) as PlanName
  const planConfig = PLANS[userPlan]
  const questions = (form.questions as Array<{ id: string; title?: string }>) ?? []

  // Total de respostas
  const { count: totalResponses } = await supabase
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', id)

  // Respostas completas
  const { count: completedResponses } = await supabase
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .eq('form_id', id)
    .eq('completed', true)

  const total = totalResponses ?? 0
  const completed = completedResponses ?? 0
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

  // TEMPO MÉDIO DE CONCLUSÃO — desativado (revisão Codex 2026-07-28).
  //
  // O código anterior consultava `created_at, updated_at` na tabela `responses`.
  // Essas colunas NÃO EXISTEM em produção: a tabela tem `submitted_at` e
  // `last_activity_at`. A query falhava a cada requisição e a métrica vinha
  // sempre nula — feature morta anunciada como viva. E não dá para calcular com
  // o schema atual: não há timestamp de INÍCIO do preenchimento.
  //
  // Para reativar: adicionar coluna de início em `responses` (SEM DEFAULT, para
  // não carimbar as linhas antigas — vide incidente de 2026-07-23), preencher no
  // insert, e só então recalcular aqui. Mantido no payload como `null` explícito
  // para não quebrar contrato de quem já consome o endpoint.
  const avgCompletionTimeSeconds: number | null = null

  // Abandono por pergunta (feature Plus+)
  const abandonmentByQuestion = planConfig?.partialResponses
    ? await (async () => {
        const { data: incompleteResponses } = await supabase
          .from('responses')
          .select('last_question_answered')
          .eq('form_id', id)
          .eq('completed', false)
          .not('last_question_answered', 'is', null)

        const abandonmentMap: Record<string, number> = {}
        for (const r of (incompleteResponses ?? [])) {
          const q = r.last_question_answered as string
          abandonmentMap[q] = (abandonmentMap[q] ?? 0) + 1
        }

        return questions.map((q, index) => ({
          question_id: q.id,
          question_title: q.title ?? `Pergunta ${index + 1}`,
          question_index: index + 1,
          abandoned_count: abandonmentMap[q.id] ?? 0,
          abandonment_rate: total > 0 ? Math.round(((abandonmentMap[q.id] ?? 0) / total) * 100) : 0,
        }))
      })()
    : questions.map((q, index) => ({
        question_id: q.id,
        question_title: q.title ?? `Pergunta ${index + 1}`,
        question_index: index + 1,
        abandoned_count: 0,
        abandonment_rate: 0,
      }))

  return NextResponse.json({
    form_id: id,
    total_responses: total,
    completed_responses: completed,
    completion_rate: completionRate,
    avg_completion_time_seconds: avgCompletionTimeSeconds,
    abandonment_by_question: abandonmentByQuestion,
    // Sinal explícito pro front (auditoria LP 2026-07-28: o endpoint existia
    // completo e gated, mas NENHUMA tela o consumia — e sem este campo a UI
    // não sabia distinguir "sem dados" de "plano sem a feature").
    plan_gated: !planConfig?.partialResponses,
  })
}
