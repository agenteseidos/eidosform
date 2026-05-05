import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, Eye, Shield } from 'lucide-react'
import { requireAdminUser } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  closed: 'Fechado',
  archived: 'Arquivado',
}

type FormRow = {
  id: string
  title: string | null
  status: string | null
  is_closed: boolean | null
  paused: boolean | null
  created_at: string
}

export default async function AdminViewAsUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser()
  const { id } = await params

  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan, plan_expires_at, plan_status, created_at, responses_used, responses_limit')
    .eq('id', id)
    .single()

  if (!profile) {
    notFound()
  }

  const { data: forms } = await supabase
    .from('forms')
    .select('id, title, status, is_closed, paused, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50)

  const formIds = (forms ?? []).map((f) => f.id)

  let responsesCount = 0
  if (formIds.length > 0) {
    const { count } = await supabase
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .in('form_id', formIds)
    responsesCount = count ?? 0
  }

  const planExpiresAt = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null
  const planExpired = planExpiresAt ? planExpiresAt.getTime() <= Date.now() : false

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/admin/users" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Voltar para Usuários
        </Link>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Modo "Ver como dono" (read-only)</p>
            <p>
              Você está visualizando os dados de <strong>{profile.email}</strong> no painel de admin. Esta página é
              somente leitura — para editar os formulários como o dono, abra o formulário direto pela ação à direita.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">Plano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold text-slate-900 capitalize">{profile.plan ?? 'free'}</p>
            <p className="text-xs text-slate-500">
              {profile.plan === 'free'
                ? 'Sem expiração'
                : planExpiresAt
                  ? `Expira em ${planExpiresAt.toLocaleDateString('pt-BR')}${planExpired ? ' (vencido)' : ''}`
                  : 'Sem expiração'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">Formulários</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">{(forms ?? []).length}</p>
            <p className="text-xs text-slate-500">Mais recentes (até 50)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">Respostas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">{responsesCount.toLocaleString('pt-BR')}</p>
            <p className="text-xs text-slate-500">
              Quota: {profile.responses_used ?? 0}/{profile.responses_limit ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Formulários do usuário</CardTitle>
          <CardDescription>
            Acesso rápido aos formulários e respostas. Os botões "Ver" abrem as páginas reais do app — você verá tudo
            que o dono veria, e qualquer edição valerá como se fosse feita pelo admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(forms ?? []).length > 0 ? (
                (forms ?? []).map((form: FormRow) => {
                  const title = form.title?.trim() ? form.title : `Form #${form.id.slice(0, 8)}`
                  const statusLabel = form.is_closed
                    ? 'Fechado'
                    : form.paused
                      ? 'Pausado'
                      : (form.status && STATUS_LABELS[form.status]) || form.status || '—'
                  return (
                    <TableRow key={form.id}>
                      <TableCell className="max-w-[260px] truncate font-medium text-slate-900">{title}</TableCell>
                      <TableCell>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{statusLabel}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(form.created_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/forms/${form.id}/responses`}>
                            <Button variant="outline" size="sm" title="Ver respostas" aria-label="Ver respostas">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/forms/${form.id}/edit`}>
                            <Button variant="outline" size="sm" title="Abrir builder" aria-label="Abrir builder">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-500">
                    Esse usuário ainda não criou formulários.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
