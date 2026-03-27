import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { v4 as uuidv4 } from 'uuid'
import { FormInsert } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

function generateSlug(): string {
  return Math.random().toString(36).substring(2, 10)
}

const MAX_SLUG_RETRIES = 3

export default async function NewFormPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const params = await searchParams
  const retryCount = parseInt(String(params.retry || '0'), 10)

  // Try to create with retries for slug collision
  let lastError: string | null = null

  for (let attempt = 0; attempt <= MAX_SLUG_RETRIES; attempt++) {
    const formId = uuidv4()
    const slug = generateSlug()

    const newForm: FormInsert = {
      id: formId,
      user_id: user.id,
      title: 'Formulário sem título',
      slug: slug,
      status: 'draft',
      theme: 'minimal',
      questions: [],
      thank_you_message: 'Obrigado pela sua resposta!',
    }

    const { error } = await supabase
      .from('forms')
      .insert(newForm as FormInsert)

    if (!error) {
      // Success — redirect to editor
      redirect(`/forms/${formId}/edit`)
    }

    if (error.code === '23505') {
      // Unique constraint violation (slug collision) — retry with new slug
      lastError = 'slug_collision'
      continue
    }

    // Other error — break
    lastError = error.message
    break
  }

  // All retries exhausted or non-retryable error — redirect to dashboard with error
  if (lastError === 'slug_collision') {
    redirect(`/dashboard?error=slug_collision&retry=${retryCount + 1}`)
  }

  redirect(`/dashboard?error=create_failed`)
}
