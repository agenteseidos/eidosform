import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicClient } from '@/lib/supabase/public'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { logError } from '@/lib/logger'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // Rate limit by IP
  const rateCheck = await checkResponseRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.' },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const body = await request.json()
    const { form_id, mime, size } = body

    // Validate required fields
    if (!form_id || !mime || size === undefined) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: form_id, mime, size' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(mime)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo inválido. Permitidos: JPEG, PNG, GIF, WebP, PDF' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validate size
    if (typeof size !== 'number' || size <= 0 || size > MAX_SIZE) {
      return NextResponse.json(
        { error: `Tamanho inválido. Máximo: ${MAX_SIZE / 1024 / 1024}MB` },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validate form exists and is published
    const admin = createAdminClient()
    const { data: form, error: formError } = await admin
      .from('forms')
      .select('id, user_id, status')
      .eq('id', form_id)
      .eq('status', 'published')
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Formulário não encontrado ou não publicado' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    // Generate storage path
    const uuid = crypto.randomUUID()
    const ext = MIME_TO_EXT[mime] || 'bin'
    const path = `${form.user_id}/${form_id}/${uuid}.${ext}`

    // Create signed upload URL
    const supabase = createPublicClient()
    const { data: signedData, error: signError } = await supabase.storage
      .from('form-uploads')
      .createSignedUploadUrl(path)

    if (signError || !signedData) {
      logError('Signed upload URL error:', signError)
      return NextResponse.json(
        { error: 'Erro ao gerar URL de upload' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    const { signedUrl, token, path: signedPath } = signedData
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/form-uploads/${path}`

    return NextResponse.json(
      { upload_url: signedUrl, upload_token: token, public_url: publicUrl, path },
      { headers: { ...CORS_HEADERS, 'X-RateLimit-Remaining': String(rateCheck.remaining) } }
    )
  } catch (error) {
    logError('Sign URL error:', error)
    return NextResponse.json(
      { error: 'Erro interno' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
