import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin-auth'
import { ResponsesDashboard } from '@/components/responses/responses-dashboard'
import { Form, Response } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface ResponsesPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ response?: string }>
}

export default async function ResponsesPage({ params, searchParams }: ResponsesPageProps) {
  const { id } = await params
  const { response: initialResponseId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Admins can view any form (impersonate via service-role); regular users only their own.
  const isAdmin = isAdminEmail(user.email)
  const dbClient = isAdmin ? createAdminClient() : supabase

  const formQuery = dbClient.from('forms').select('*').eq('id', id)
  const { data: formData, error: formError } = await (
    isAdmin ? formQuery.single() : formQuery.eq('user_id', user.id).single()
  )

  const form = formData as Form | null

  if (formError || !form) {
    notFound()
  }

  // P1-G1: Server-side pagination — load first 500 responses max to prevent memory issues
  // For admin viewing someone else's form, fetch the form owner's plan (not the admin's).
  const profileUserId = isAdmin ? form.user_id : user.id
  const [{ data: responsesData, count: totalCount }, { data: profile }] = await Promise.all([
    dbClient
      .from('responses')
      .select('*', { count: 'exact' })
      .eq('form_id', id)
      .order('submitted_at', { ascending: false })
      .range(0, 499),
    dbClient
      .from('profiles')
      .select('plan')
      .eq('id', profileUserId)
      .single(),
  ])

  const responses = (responsesData || []) as Response[]
  const userPlan = (profile?.plan as string) || 'free'
  const totalResponseCount = totalCount ?? responses.length
  const hasMoreResponses = totalResponseCount > 500

  return (
    <ResponsesDashboard
      form={form}
      responses={responses}
      userPlan={userPlan}
      totalResponseCount={totalResponseCount}
      hasMoreResponses={hasMoreResponses}
      initialResponseId={initialResponseId}
    />
  )
}

