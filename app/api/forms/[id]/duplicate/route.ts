import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST /api/forms/[id]/duplicate — duplicate a form
export async function POST(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch original form
  const { data: original, error: fetchError } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !original) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // Generate unique slug for the copy
  const baseSlug = original.slug.replace(/-copia(-[a-z0-9]+)?$/, '')
  const uniqueSuffix = Date.now().toString(36)
  const newSlug = `${baseSlug}-copia-${uniqueSuffix}`

  // Create duplicate
  const { data: duplicate, error: insertError } = await supabase
    .from('forms')
    .insert({
      user_id: user.id,
      title: `${original.title || 'Formulário'} (cópia)`,
      slug: newSlug,
      description: original.description || null,
      theme: original.theme || 'midnight',
      questions: original.questions || [],
      thank_you_message: original.thank_you_message || 'Obrigado pela sua resposta!',
      pixels: original.pixels || null,
      redirect_url: original.redirect_url || null,
      webhook_url: original.webhook_url || null,
      status: 'draft',
      plan: original.plan || 'free',
    })
    .select()
    .single()

  if (insertError || !duplicate) {
    return NextResponse.json({ error: 'Failed to duplicate form' }, { status: 500 })
  }

  return NextResponse.json({ form: duplicate }, { status: 201 })
}
