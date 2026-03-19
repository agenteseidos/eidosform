import { notFound } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase/public'
import { FormPlayer } from '@/components/form-player/form-player'
import { Form } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface FormPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: FormPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()

  const { data } = await supabase
    .from('forms')
    .select('title, description')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  const form = data as { title: string; description: string | null } | null

  if (!form) {
    return { title: 'Formulário Não Encontrado' }
  }

  return {
    title: form.title || 'Formulário',
    description: form.description || 'Preencha este formulário',
  }
}

export default async function FormPage({ params }: FormPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()

  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  const form = data as (Form & { user_id: string }) | null

  if (error || !form) {
    notFound()
  }

  // Bug #3: Fetch owner's plan to gate pixel rendering
  let ownerPlan = 'free'
  if (form.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('user_id', form.user_id)
      .single() as { data: { plan: string } | null }
    if (profile?.plan) {
      ownerPlan = profile.plan
    }
  }

  return <FormPlayer form={form} ownerPlan={ownerPlan} />
}
