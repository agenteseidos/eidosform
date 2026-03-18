import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: Promise<{ id: string }>
}

async function authenticateApiKey(req: NextRequest): Promise<{ userId: string; plan: string; apiKey: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, plan, api_key')
    .eq('api_key', apiKey)
    .single() as { data: { user_id: string; plan: string; api_key: string } | null }

  if (!profile) return null
  if (profile.plan !== 'professional' && profile.plan !== 'enterprise') return null

  const limit = checkRateLimit(apiKey)
  if (!limit.allowed) return null

  return { userId: profile.user_id, plan: profile.plan, apiKey }
}

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// GET /api/v1/forms/[id] — detalhes do form
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized. Professional plan required.' }, { status: 401 })
  }

  const { id } = await params
  const supabase = getServiceClient()
  const url = new URL(req.url)
  const subpath = url.searchParams.get('resource')

  // GET /api/v1/forms/[id]?resource=responses — listar respostas
  if (subpath === 'responses') {
    const page = parseInt(url.searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
    const offset = (page - 1) * limit

    // Verificar ownership
    const { data: form } = await supabase
      .from('forms')
      .select('id')
      .eq('id', id)
      .eq('user_id', auth.userId)
      .single()

    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }

    const { data: responses, count, error } = await supabase
      .from('responses')
      .select('id, answers, completed, last_question_answered, created_at, updated_at', { count: 'exact' })
      .eq('form_id', id)
      .eq('completed', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
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

  // GET /api/v1/forms/[id] — detalhes do form
  const { data: form, error } = await supabase
    .from('forms')
    .select('id, title, slug, status, questions, settings, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .single()

  if (error || !form) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  return NextResponse.json({ form })
}

// POST /api/v1/forms/[id]/responses via subpath ?resource=responses
// ou diretamente POST /api/v1/forms/[id] com body { resource: 'responses', ... }
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized. Professional plan required.' }, { status: 401 })
  }

  const { id } = await params
  const supabase = getServiceClient()
  const body = await req.json()
  const { answers, completed = true } = body

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers is required' }, { status: 400 })
  }

  // Verificar form
  const { data: form } = await supabase
    .from('forms')
    .select('id, user_id, status')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .eq('status', 'published')
    .single()

  if (!form) {
    return NextResponse.json({ error: 'Form not found or not published' }, { status: 404 })
  }

  const { data: response, error } = await supabase
    .from('responses')
    .insert({ form_id: id, answers, completed } as never)
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (error || !response) {
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  // Inserir answer_items
  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: response.id,
    question_id: questionId,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }))

  if (answerItems.length > 0) {
    await supabase.from('answer_items').insert(answerItems as never)
  }

  return NextResponse.json({ response_id: response.id }, { status: 201 })
}
