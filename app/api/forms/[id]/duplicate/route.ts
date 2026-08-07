import { NextRequest, NextResponse } from 'next/server'
import { FormInsert } from '@/lib/database.types'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkFormLimit, PLANS } from '@/lib/plan-limits'
import { normalizePlan, getEffectivePlan } from '@/lib/plans'
import { logError } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'form'
}

// O slug resolve GLOBALMENTE na URL pública (/f/<slug>), então a busca por um
// candidato livre também precisa ser global. Antes escopava por `user_id`, o que
// devolvia slug já usado por OUTRA conta — com o índice único global isso passa a
// estourar 23505 na inserção. (Auditoria 2026-08, lote 1C.)
async function generateUniqueSlug(supabase: ReturnType<typeof createAdminClient>, baseSlug: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? 'copy' : `copy-${attempt + 1}`
    const candidate = `${baseSlug}-${suffix}`.slice(0, 60)

    const { data: existing } = await supabase
      .from('forms')
      .select('id')
      .eq('slug', candidate)
      .limit(1)
      .maybeSingle()

    if (!existing) return candidate
  }

  return `${baseSlug}-${Date.now()}`.slice(0, 60)
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Enforce form limit before duplicating
  const formLimit = await checkFormLimit(user.id)
  if (!formLimit.allowed) {
    return NextResponse.json(
      { error: `Limite de formulários atingido (${formLimit.usage}/${formLimit.limit}). Faça upgrade do plano.` },
      { status: 403 }
    )
  }

  // Plano do dono — para os gates que POST e PATCH já aplicam e a duplicação pulava.
  // (auditoria 2026-08, lote 2-bis · D6)
  const supabase = createAdminClient()
  const { data: dupProfile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const dupPlan = getEffectivePlan(dupProfile)
  const dupPlanConfig = PLANS[dupPlan]

  const { id } = await params

  // P2-02 FIX: Avoid select('*') — specify only needed columns for duplication
  const { data: sourceForm, error: sourceError } = await supabase
    .from('forms')
    .select('id, title, description, slug, theme, questions, thank_you_enabled, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, plan, redirect_url, webhook_url, pixel_event_on_start, pixel_event_on_complete, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (sourceError || !sourceForm) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // maxQuestions: POST (`forms/route.ts:107`) e PATCH (`forms/[id]/route.ts:139`) recusam 403
  // acima do teto do plano; a duplicação copiava `questions` sem contar nada. Um dono que caiu
  // para Free com um formulário legado de 200 perguntas gerava formulários NOVOS de 200 à
  // vontade. (lote 2-bis · D6)
  const srcQuestions = Array.isArray(sourceForm.questions) ? sourceForm.questions : []
  const maxQuestions = dupPlanConfig?.maxQuestions ?? 25
  if (srcQuestions.length > maxQuestions) {
    return NextResponse.json(
      { error: `Este formulário tem ${srcQuestions.length} perguntas e seu plano (${dupPlan}) permite ${maxQuestions}. Reduza as perguntas antes de duplicar.` },
      { status: 403 }
    )
  }

  const baseSlug = slugify(sourceForm.slug || sourceForm.title || 'form')
  const duplicateSlug = await generateUniqueSlug(supabase, baseSlug)
  const now = new Date().toISOString()

  const duplicateForm: FormInsert = {
    user_id: user.id,
    title: `${sourceForm.title} (Cópia)`,
    description: sourceForm.description,
    slug: duplicateSlug,
    status: 'draft',
    is_published: false,
    theme: sourceForm.theme,
    questions: sourceForm.questions,
    thank_you_enabled: sourceForm.thank_you_enabled,
    thank_you_message: sourceForm.thank_you_message,
    thank_you_title: sourceForm.thank_you_title,
    thank_you_description: sourceForm.thank_you_description,
    thank_you_button_text: sourceForm.thank_you_button_text,
    thank_you_button_url: sourceForm.thank_you_button_url,
    pixels: null,
    plan: normalizePlan(sourceForm.plan),
    // redirect pós-envio é Starter+ — strip silencioso, igual ao POST (`forms/route.ts:166`)
    // e ao `webhook_url`/`pixels` logo acima, que a duplicação já zerava. (lote 2-bis · D6)
    redirect_url: dupPlanConfig?.redirect ? sourceForm.redirect_url : null,
    webhook_url: null,
    pixel_event_on_start: null,
    pixel_event_on_complete: null,
    welcome_enabled: sourceForm.welcome_enabled,
    welcome_title: sourceForm.welcome_title,
    welcome_description: sourceForm.welcome_description,
    welcome_button_text: sourceForm.welcome_button_text,
    welcome_image_url: sourceForm.welcome_image_url,
    created_at: now,
    updated_at: now,
  }

  // P2-02 FIX: Avoid select('*') after insert — specify needed columns
  const { data: duplicated, error: duplicateError } = await supabase
    .from('forms')
    .insert(duplicateForm)
    .select('id, title, slug, status, created_at')
    .single()

  if (duplicateError || !duplicated) {
    logError('Failed to duplicate form:', duplicateError)
    return NextResponse.json({ error: 'Erro ao duplicar formulário' }, { status: 500 })
  }

  return NextResponse.json({ form: duplicated }, { status: 201 })
}
