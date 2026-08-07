import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { checkUploadSignRateLimitAsync, checkUploadSignPreflightAsync } from '@/lib/response-rate-limit'
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

function mimeMatchesAllowedType(mime: string, allowedType: string): boolean {
  if (allowedType === mime) return true
  if (!allowedType.endsWith('/*')) return false
  return mime.startsWith(allowedType.slice(0, -1))
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

  // PRÉ-FILTRO por IP, antes de ler o corpo (o `form_id` só existe depois do parse).
  // Sem ele, mover o rate limit para depois do JSON deixaria a rota aceitar corpo arbitrário
  // de graça. Teto generoso de propósito: é rede contra flood, não a régua de negócio.
  const pre = await checkUploadSignPreflightAsync(ip)
  if (!pre.allowed) {
    const retryAfter = Math.ceil(pre.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.' },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const body = await request.json()
    const { form_id, mime, size, question_id } = body

    // Validate required fields
    if (!form_id || !mime || size === undefined || typeof question_id !== 'string' || !question_id) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: form_id, question_id, mime, size' },
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

    // Orçamento PRÓPRIO da assinatura de upload: 20/min por IP+form, teto global 40/min por IP.
    //
    // Antes esta rota gastava `resp:${ip}` — o balde do SUBMIT FINAL (10/min). Anexar arquivos
    // consumia o orçamento do próprio envio da resposta, e como este é o fluxo ANÔNIMO o alcance
    // era maior que o do autosave autenticado. Terceira rota do mesmo defeito; as outras duas
    // são `/api/responses/partial` (corrigida em 08/07) e `/api/forms/[id]/partial-response`
    // (corrigida junto com esta). (auditoria 2026-08, lote 2 · gêmea do L2-4)
    const rateCheck = await checkUploadSignRateLimitAsync(ip, String(form_id))
    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
      return NextResponse.json(
        { error: 'Muitas requisições. Tente novamente mais tarde.' },
        { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) } }
      )
    }

    // Validate form exists and is published
    const admin = createAdminClient()
    const { data: form, error: formError } = await admin
      .from('forms')
      .select('id, user_id, status, questions')
      .eq('id', form_id)
      .eq('status', 'published')
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Formulário não encontrado ou não publicado' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const questions = (form.questions ?? []) as Array<{
      id: string
      type?: string
      maxFileSize?: number
      allowedFileTypes?: string[]
    }>
    const question = questions.find((q) => q.id === question_id)
    if (!question || question.type !== 'file_upload') {
      return NextResponse.json(
        { error: 'Pergunta de upload inválida para este formulário' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (
      Array.isArray(question.allowedFileTypes) &&
      question.allowedFileTypes.length > 0 &&
      !question.allowedFileTypes.some((allowedType) => mimeMatchesAllowedType(mime, allowedType))
    ) {
      return NextResponse.json(
        { error: 'Tipo de arquivo não permitido nesta pergunta' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // O bucket impõe 10MB sobre o arquivo efetivamente recebido. Aqui aplicamos
    // também o limite mais restritivo configurado na pergunta antes de assinar.
    const questionLimitMb = Math.min(question.maxFileSize ?? 10, MAX_SIZE / 1024 / 1024)
    const limitBytes = questionLimitMb * 1024 * 1024
    if (size > limitBytes) {
      return NextResponse.json(
        { error: `Arquivo excede o limite desta pergunta (${questionLimitMb}MB)` },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Generate storage path
    const uuid = crypto.randomUUID()
    const ext = MIME_TO_EXT[mime] || 'bin'
    const path = `${form.user_id}/${form_id}/${uuid}.${ext}`

    // Create signed upload URL
    const supabase = createServiceRoleClient()
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

    const { signedUrl, token } = signedData
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
