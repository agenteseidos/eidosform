import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'

export async function GET() {
  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from('forms')
      .select('id, questions')
      .eq('id', 'af8ea379-cea0-4471-b1ee-d63e2daffc19')
      .single()

    if (error) return NextResponse.json({ error: error.message })

    const questions = (data?.questions as Array<{ id: string; type?: string; title?: string }>) ?? []
    return NextResponse.json({
      formId: data?.id,
      questions: questions.map(q => ({ id: q.id, type: q.type, title: q.title?.substring(0, 40) }))
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) })
  }
}
