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

  // Tempo médio de conclusão (limitado a 10k para evitar DoS em forms populares)
  const { data: completedTimestamps } = await supabase
    .from('responses')
    .select('created_at, updated_at')
    .eq('form_id', id)
    .eq('completed', true)
    .limit(10000)

  let avgCompletionTimeSeconds: number | null = null
  if (planConfig?.partialResponses && completedTimestamps && completedTimestamps.length > 0) {
    const durations = completedTimestamps
      .map((r: { created_at: string; updated_at: string | null }) => {
        const start = new Date(r.created_at).getTime()
        const end = new Date(r.updated_at ?? r.created_at).getTime()
        return (end - start) / 1000
      })
      .filter((d: number) => d > 0)
    if (durations.length > 0) {
      avgCompletionTimeSeconds = Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
    }
  }

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
  })
}
