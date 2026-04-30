import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { checkUploadRateLimitAsync } from '@/lib/upload-rate-limit'
import { logError } from '@/lib/logger'

// Magic byte signatures for supported file types
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]], // GIF8
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF...WEBP
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
}

function detectMimeType(buf: Buffer): string | null {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    if (signatures.some(sig => buf.slice(0, sig.length).equals(Buffer.from(sig)))) {
      // Extra check: WEBP must have WEBP at offset 8
      if (mime === 'image/webp') {
        const webpTag = buf.slice(8, 12).toString('ascii')
        if (webpTag !== 'WEBP') continue
      }
      return mime
    }
  }
  return null
}

// Check if R2 is configured
function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  )
}

// Create R2 client (lazy initialization)
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
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type (client-reported MIME)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF' }, { status: 400 })
    }

    // Validate magic bytes (don't trust client MIME)
    let effectiveMime = file.type
    const buffer = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectMimeType(buffer)
    if (!detectedMime || !allowedTypes.includes(detectedMime)) {
      return NextResponse.json({ error: 'Invalid file content. File content does not match declared type.' }, { status: 400 })
    }
    if (detectedMime !== file.type) {
      effectiveMime = detectedMime
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large. Maximum size is 10MB' }, { status: 400 })
    }

    const r2 = getR2Client()
    
    if (!r2) {
      return NextResponse.json({ 
        error: 'File storage not configured. Please set R2 environment variables.',
        configured: false 
      }, { status: 503 })
    }

    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 8)
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const key = `uploads/${user.id}/${timestamp}-${randomId}-${sanitizedName}`
    
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: effectiveMime,
    }))

    const publicUrl = process.env.R2_PUBLIC_URL 
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`

    return NextResponse.json({
      success: true,
      url: publicUrl,
      file: {
        name: file.name,
        type: effectiveMime,
        size: file.size,
      },
    }, {
      headers: {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    })
  } catch (error) {
    logError('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

// GET endpoint to check if R2 is configured (requires auth)
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    configured: isR2Configured(),
  })
}
