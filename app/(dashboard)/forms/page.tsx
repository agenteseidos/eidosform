import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FileText, Plus, AlertTriangle } from 'lucide-react'
import { Form, Folder } from '@/lib/database.types'
import { TemplatesGallery } from '@/components/dashboard/templates-gallery'
import { OnboardingWrapper } from '@/components/dashboard/onboarding-wrapper'
import { ErrorToast } from '@/components/dashboard/error-toast'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { PlanQuotaCard } from '@/components/dashboard/plan-quota-card'
import { type PlanName } from '@/lib/plan-definitions'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // P2-G: Select only needed fields instead of '*' and use aggregate query for response counts
  const [{ data: formsData }, { data: foldersData }] = await Promise.all([
    supabase
      .from('forms')
      .select('id, title, description, slug, status, theme, questions, is_closed, paused, updated_at, created_at, folder_id')
      .eq('user_id', user!.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('folders')
      .select('id, name, created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true }),
  ])

  const forms = (formsData || []) as Form[]
  const folders = (foldersData || []) as Folder[]

  // P2-G: Use aggregate RPC for response counts instead of loading all responses
  const formIds = forms.map(f => f.id)
  let responseCountsByForm: Record<string, number> = {}
  if (formIds.length > 0) {
    const { data: counts } = await (supabase as any)
      .rpc('get_response_counts_by_forms', { p_form_ids: formIds })
    if (counts) {
      for (const c of counts) {
        responseCountsByForm[c.form_id] = c.response_count
      }
    }
  }

  const { data: profileQuota } = await supabase
    .from('profiles')
    .select('plan, responses_used, responses_limit')
    .eq('id', user!.id)
    .single()

  const planName = (profileQuota?.plan ?? 'free') as PlanName
  const responsesUsed = profileQuota?.responses_used ?? 0
  const responsesLimit = profileQuota?.responses_limit ?? 100

  const isNewUser = forms.length === 0
  const pausedForms = forms.filter(f => (f as { paused?: boolean }).paused).length

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Suspense><ErrorToast /></Suspense>
      <PlanQuotaCard
        planName={planName}
        responsesUsed={responsesUsed}
        responsesLimit={responsesLimit}
        formsUsed={forms.length}
      />
      <OnboardingWrapper isNewUser={isNewUser} />
      {pausedForms > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900">
              {pausedForms} {pausedForms === 1 ? 'formulário pausado' : 'formulários pausados'}
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Seu plano expirou e {pausedForms === 1 ? 'este formulário não está' : 'esses formulários não estão'} recebendo novas respostas. Faça upgrade para reativar.
            </p>
            <Link href="/billing" className="inline-block mt-2 text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700">
              Ver planos →
            </Link>
          </div>
        </div>
      )}
      <div className="mb-6 sm:mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Meus Formulários</h1>
          <p className="mt-1 text-slate-600">Crie e gerencie seus formulários</p>
        </div>
        <TemplatesGallery />
      </div>

      {forms.length === 0 ? (
        <Card className="p-16 text-center border-dashed border-2 border-blue-200/60 bg-gradient-to-br from-white via-blue-50/30 to-sky-50/30">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-100 to-sky-100 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <FileText className="w-10 h-10 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Crie seu primeiro formulário</h2>
          <p className="text-slate-600 mb-8 max-w-md mx-auto leading-relaxed">
            Crie formulários bonitos que as pessoas querem responder. Uma pergunta de cada vez.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/forms/new">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-blue-600/35 hover:-translate-y-0.5">
                <Plus className="w-5 h-5 mr-2" />
                Criar do zero
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <DashboardShell
          forms={forms}
          folders={folders}
          responseCounts={responseCountsByForm}
        />
      )}
    </div>
  )
}
