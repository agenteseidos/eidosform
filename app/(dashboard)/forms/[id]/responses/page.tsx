import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ResponsesDashboard } from '@/components/responses/responses-dashboard'
import { Form, Response } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface ResponsesPageProps {
  params: Promise<{ id: string }>
}

export default async function ResponsesPage({ params }: ResponsesPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: formData, error: formError } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const form = formData as Form | null

  if (formError || !form) {
    notFound()
  }

  const [{ data: responsesData }, { data: profile }] = await Promise.all([
    supabase
      .from('responses')
      .select('*')
      .eq('form_id', id)
      .order('submitted_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single(),
  ])

  const responses = (responsesData || []) as Response[]
  const userPlan = (profile?.plan as string) || 'free'

  return (
    <ResponsesDashboard
      form={form}
      responses={responses}
      userPlan={userPlan}
    />
  )
}

