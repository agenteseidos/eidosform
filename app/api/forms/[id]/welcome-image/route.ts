import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUploadRateLimitAsync } from '@/lib/upload-rate-limit'
import { logError } from '@/lib/logger'

// Upload da imagem da tela de boas-vindas — server-side com service role.
// Substitui o upload browser→Storage direto (dependia de RLS + sessão hidratada
// no client e quebrava com "new row violates row-level security policy").
// SVG fica de fora de propósito: o PATCH /api/forms/[id] bloqueia .svg em
// welcome_image_url (P2-B, risco XSS) — aceitar aqui criaria upload órfão.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_SIZE = 2 * 1024 * 1024 // 2MB (mesmo limite exibido no builder)

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// Magic bytes (mesmo esquema do /api/upload — duplicado porque route.ts não
// pode exportar helpers além dos handlers)
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
}

function detectMimeType(buf: Buffer): string | null {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    if (signatures.some(sig => buf.slice(0, sig.length).equals(Buffer.from(sig)))) {
      if (mime === 'image/webp') {
        const webpTag = buf.slice(8, 12).toString('ascii')
        if (webpTag !== 'WEBP') continue
      }
      return mime
    }
  }
  return null
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST /api/forms/[id]/welcome-image — sobe a imagem e devolve { url }
export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const rateCheck = await checkUploadRateLimitAsync(user.id)
    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again in a moment.', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    // Ownership: o form precisa existir e ser do usuário (RLS reforça via
    // client de sessão — mesmo padrão do GET /api/forms/[id])
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (formError || !form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Formato não suportado. Use PNG, JPG, GIF ou WEBP.' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo 2MB.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectMimeType(buffer)
    if (!detectedMime || !ALLOWED_TYPES.includes(detectedMime)) {
      return NextResponse.json({ error: 'Conteúdo do arquivo inválido.' }, { status: 400 })
    }
    const effectiveMime = detectedMime !== file.type ? detectedMime : file.type

    const admin = createAdminClient()
    const ext = MIME_TO_EXT[effectiveMime] || 'bin'
    const path = `welcome/${form.id}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await admin.storage
      .from('form-images')
      .upload(path, buffer, { contentType: effectiveMime, upsert: false })
    if (uploadError) {
      logError('Welcome image upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/form-images/${path}`

    return NextResponse.json({ success: true, url: publicUrl })
  } catch (error) {
    logError('Welcome image upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
