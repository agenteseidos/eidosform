import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUploadRateLimitAsync } from '@/lib/upload-rate-limit'
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

// Magic byte signatures for supported file types
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
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

export async function POST(request: NextRequest) {
  // Require authentication
  const supabase = await createClient()
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

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF' }, { status: 400 })
    }

    // Validate magic bytes
    const buffer = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectMimeType(buffer)
    if (!detectedMime || !ALLOWED_TYPES.includes(detectedMime)) {
      return NextResponse.json({ error: 'Invalid file content.' }, { status: 400 })
    }
    const effectiveMime = detectedMime !== file.type ? detectedMime : file.type

    // Validate file size
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 10MB' }, { status: 400 })
    }

    // Upload to Supabase Storage via admin client (bypasses RLS)
    const admin = createAdminClient()
    const uuid = crypto.randomUUID()
    const ext = MIME_TO_EXT[effectiveMime] || 'bin'
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const path = `assets/${user.id}/${uuid}-${sanitizedName}.${ext}`

    const { error: uploadError } = await admin.storage
      .from('form-uploads')
      .upload(path, buffer, { contentType: effectiveMime, upsert: false })

    if (uploadError) {
      logError('Supabase upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/form-uploads/${path}`

    return NextResponse.json({
      success: true,
      url: publicUrl,
      file: { name: file.name, type: effectiveMime, size: file.size },
    })
  } catch (error) {
    logError('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

// GET endpoint to check if storage is configured
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL })
}
