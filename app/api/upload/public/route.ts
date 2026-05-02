import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createPublicClient } from '@/lib/supabase/public'
import { checkUploadRateLimitAsync } from '@/lib/upload-rate-limit'
import { logError } from '@/lib/logger'

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

function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  )
}

function getR2Client(): S3Client | null {
  if (!isR2Configured()) return null
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
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
  // Rate limit by IP (anonymous users)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rateCheck = await checkUploadRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.', retryAfter },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400, headers: CORS_HEADERS })
    }

    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo inválido. Permitidos: JPEG, PNG, GIF, WebP, PDF' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validate magic bytes
    const buffer = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectMimeType(buffer)
    if (!detectedMime || !allowedTypes.includes(detectedMime)) {
      return NextResponse.json(
        { error: 'Conteúdo do arquivo inválido.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }
    const effectiveMime = detectedMime !== file.type ? detectedMime : file.type

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Arquivo muito grande. Máximo: 10MB' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const r2 = getR2Client()
    if (!r2) {
      return NextResponse.json(
        { error: 'Storage não configurado', configured: false },
        { status: 503, headers: CORS_HEADERS }
      )
    }

    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 8)
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const key = `public-uploads/${timestamp}-${randomId}-${sanitizedName}`

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: effectiveMime,
    }))

    const publicUrl = process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`

    return NextResponse.json(
      { success: true, url: publicUrl, file: { name: file.name, type: effectiveMime, size: file.size } },
      { headers: { ...CORS_HEADERS, 'X-RateLimit-Remaining': String(rateCheck.remaining) } }
    )
  } catch (error) {
    logError('Public upload error:', error)
    return NextResponse.json({ error: 'Falha no upload' }, { status: 500, headers: CORS_HEADERS })
  }
}
