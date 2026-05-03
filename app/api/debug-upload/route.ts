import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'

export async function GET(req: NextRequest) {
  try {
    const supabase = createPublicClient()
    
    // Test 1: List buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    if (bucketsError) {
      return NextResponse.json({ step: 'listBuckets', error: bucketsError.message })
    }
    
    // Test 2: Try to create signed upload URL
    const { data: signed, error: signError } = await supabase.storage
      .from('form-uploads')
      .createSignedUploadUrl('test/test.txt')
    
    return NextResponse.json({
      buckets: buckets?.map((b: {id: string}) => b.id),
      signUrl: !!signed?.signedUrl,
      signError: signError?.message || null,
      env: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'missing',
        key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'missing',
      }
    })
  } catch (err: unknown) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 3) : null
    })
  }
}

