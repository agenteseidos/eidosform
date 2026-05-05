import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin-auth'
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

  // Admins can edit any form (impersonate via service-role); regular users only their own.
  const isAdmin = isAdminEmail(user.email)
  const dbClient = isAdmin ? createAdminClient() : supabase

  const baseQuery = dbClient.from('forms').select('*').eq('id', id)
  const { data, error } = await (
    isAdmin ? baseQuery.single() : baseQuery.eq('user_id', user.id).single()
  )

  const form = data as Form | null

  if (error || !form) {
    notFound()
  }

  // For admin viewing/editing someone else's form, fetch the form owner's plan
  // so the builder shows feature gates from the dono's perspective, not the admin's.
  const profileUserId = isAdmin ? form.user_id : user.id
  const { data: profile } = await dbClient
    .from('profiles')
    .select('plan')
    .eq('id', profileUserId)
    .single()

  const userPlan = (profile?.plan as string) || 'free'

  // B20: Passar info do usuário para o builder (avatar no header)
  const userInfo = {
    email: user.email || '',
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
  }

  return <FormBuilder form={form} userPlan={userPlan} userInfo={userInfo} />
}

