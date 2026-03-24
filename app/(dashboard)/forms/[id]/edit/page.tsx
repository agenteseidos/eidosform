import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FormBuilder } from '@/components/form-builder/form-builder'
import { Form } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface EditFormPageProps {
  params: Promise<{ id: string }>
}

export default async function EditFormPage({ params }: EditFormPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const form = data as Form | null

  if (error || !form) {
    notFound()
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const userPlan = (profile?.plan as string) || 'free'

  return <FormBuilder form={form} userPlan={userPlan} />
}

