import type { CustomDomainInsert } from '@/lib/database.types'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { addDomain, removeDomain, checkDomainStatus } from '@/lib/custom-domain'
import { logError } from '@/lib/logger'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plans'
import { checkRateLimitAsync } from '@/lib/rate-limit'

// POST /api/domains — adicionar domínio personalizado
// Body: { domain: string, form_id: string }
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { domain, form_id } = body

  if (!domain || !form_id) {
    return NextResponse.json({ error: 'domain and form_id are required' }, { status: 400 })
  }

  // P0 FIX: Feature gate — custom domains require Professional plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const userPlan = getEffectivePlan(profile) as PlanName
  if (!PLANS[userPlan]?.customDomain) {
    return NextResponse.json(
      { error: 'Domínio personalizado requer plano Professional' },
      { status: 403 }
    )
  }

  // Verificar ownership do form
  const { data: form } = await supabase
    .from('forms')
    .select('id, slug')
    .eq('id', form_id)
    .eq('user_id', user.id)
    .single()

  if (!form) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // Prevent domain takeover: check if domain already belongs to another user.
  // B7 (auditoria 2026-06-10): lista TODAS as linhas em vez de .single() — com
  // registros duplicados, .single() erra silenciosamente e o check era pulado.
  const { data: existingDomains, error: existingError } = await supabase
    .from('custom_domains')
    .select('id, user_id')
    .eq('domain', domain)
  if (existingError) {
    logError('Failed to check existing domain ownership:', existingError)
    return NextResponse.json({ error: 'Failed to verify domain availability' }, { status: 500 })
  }
  if ((existingDomains ?? []).some((d) => d.user_id !== user.id)) {
    return NextResponse.json(
      { error: 'This domain is already registered by another user' },
      { status: 409 }
    )
  }

  const result = await addDomain(domain, form.slug)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Salvar associação no banco
  const { error: dbError } = await supabase
    .from('custom_domains')
    .upsert({
      domain,
      form_id,
      user_id: user.id,
      verified: result.verified ?? false,
    } as CustomDomainInsert)

  if (dbError) {
    logError('Failed to save domain to DB:', dbError)
  }

  return NextResponse.json({
    domain: result.domain,
    verified: result.verified,
    cname: result.cname,
    aRecords: result.aRecords,
    message: result.verified
      ? 'Domain added and verified'
      : 'Domain added. Configure your DNS and wait for verification.',
  }, { status: 201 })
}

// GET /api/domains — listar domínios do usuário
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // P1 FIX: Feature gate — custom domains require Professional plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const userPlan = getEffectivePlan(profile) as PlanName
  if (!PLANS[userPlan]?.customDomain) {
    return NextResponse.json(
      { error: 'Domínio personalizado requer plano Professional' },
      { status: 403 }
    )
  }

  // P2-01 FIX: Avoid select('*') — specify only needed columns
  const { data: domains, error } = await supabase
    .from('custom_domains')
    .select('id, domain, form_id, verified, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch domains' }, { status: 500 })
  }

  return NextResponse.json({ domains })
}

// DELETE /api/domains — remover domínio
// Body: { domain: string }
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // B8 (auditoria 2026-06-10): rate limit em ação destrutiva.
  const { allowed } = await checkRateLimitAsync(`domains:delete:${user.id}`, {
    maxAttempts: 5,
    windowMs: 60_000,
  })
  if (!allowed) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 })
  }

  // P1 FIX: Feature gate — custom domains require Professional plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const userPlan = getEffectivePlan(profile) as PlanName
  if (!PLANS[userPlan]?.customDomain) {
    return NextResponse.json(
      { error: 'Domínio personalizado requer plano Professional' },
      { status: 403 }
    )
  }

  const body = await req.json()
  const { domain } = body

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  // Verificar ownership
  const { data: existing } = await supabase
    .from('custom_domains')
    .select('id')
    .eq('domain', domain)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  const result = await removeDomain(domain)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  await supabase.from('custom_domains').delete().eq('domain', domain).eq('user_id', user.id)

  return NextResponse.json({ message: 'Domain removed successfully' })
}

// PATCH /api/domains — verificar status de um domínio
// Body: { domain: string }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // P1 FIX: Feature gate — custom domains require Professional plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single()
  const userPlan = getEffectivePlan(profile) as PlanName
  if (!PLANS[userPlan]?.customDomain) {
    return NextResponse.json(
      { error: 'Domínio personalizado requer plano Professional' },
      { status: 403 }
    )
  }

  const body = await req.json()
  const { domain } = body

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('custom_domains')
    .select('id')
    .eq('domain', domain)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  const result = await checkDomainStatus(domain)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Atualizar status no banco
  if (result.verified) {
    await supabase
      .from('custom_domains')
      .update({ verified: true } as CustomDomainInsert)
      .eq('domain', domain)
      .eq('user_id', user.id)
  }

  return NextResponse.json({
    domain: result.domain,
    verified: result.verified,
    cname: result.cname,
    aRecords: result.aRecords,
  })
}
