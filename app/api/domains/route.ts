import type { CustomDomainInsert, CustomDomainUpdate } from '@/lib/database.types'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { addDomain, removeDomain, checkDomainStatus } from '@/lib/custom-domain'
import { logError } from '@/lib/logger'

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
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: domains, error } = await supabase
    .from('custom_domains')
    .select('*')
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
    .single()

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

  const body = await req.json()
  const { domain } = body

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
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
