import { validateWebhookUrl } from '@/lib/webhook-validator'
/**
 * app/api/forms/[id]/webhook/route.ts — Gerenciar webhook_url do form
 * GET: retorna configuração atual
 * PUT: atualiza webhook_url
 * DELETE: remove webhook_url
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: form, error } = await supabase
    .from('forms')
    .select('id, webhook_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  return NextResponse.json({ webhook_url: form.webhook_url })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { webhook_url } = body

  if (webhook_url) {
    const urlCheck = validateWebhookUrl(webhook_url)
    if (!urlCheck.safe) {
      return NextResponse.json({ error: urlCheck.reason }, { status: 400 })
    }
  }

  const { error } = await supabase
    .from('forms')
    .update({ webhook_url })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, webhook_url })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('forms')
    .update({ webhook_url: null })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
