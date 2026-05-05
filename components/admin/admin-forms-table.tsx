"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Eye, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type AdminForm = {
  id: string
  title: string
  status: string | null
  isClosed: boolean
  paused: boolean
  createdAt: string
  updatedAt: string | null
  ownerId: string
  ownerEmail: string | null
  responsesCount: number
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  closed: 'Fechado',
  archived: 'Arquivado',
}

export function AdminFormsTable({ initialOwner = '' }: { initialOwner?: string } = {}) {
  const [forms, setForms] = useState<AdminForm[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setServerSearch(search.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    let active = true

    async function loadForms() {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams()
        if (serverSearch) params.set('search', serverSearch)
        if (initialOwner) params.set('owner', initialOwner)
        params.set('page', String(page))
        params.set('limit', '20')

        const response = await fetch(`/api/admin/forms?${params.toString()}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Falha ao carregar formulários')

        const json = await response.json() as { forms: AdminForm[]; total: number }
        if (active) {
          setForms(json.forms)
          setTotal(json.total ?? json.forms.length)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar formulários')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadForms()
    return () => {
      active = false
    }
  }, [serverSearch, page, initialOwner])

  const emptyMessage = useMemo(() => {
    if (loading) return 'Carregando formulários...'
    if (error) return error
    if (serverSearch) return 'Nenhum formulário encontrado para essa busca.'
    return 'Nenhum formulário encontrado.'
  }, [error, loading, serverSearch])

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <Card className="border-slate-200 bg-white">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título"
              className="pl-9"
            />
          </div>
          <p className="text-sm text-slate-500">
            {loading ? 'Carregando...' : `${total} form(s)`}
          </p>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.length > 0 ? (
                forms.map((form) => {
                  const statusLabel = form.isClosed
                    ? 'Fechado'
                    : form.paused
                      ? 'Pausado'
                      : (form.status && STATUS_LABELS[form.status]) || form.status || '—'
                  return (
                    <TableRow key={form.id}>
                      <TableCell className="max-w-[260px] truncate font-medium text-slate-900">{form.title}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-slate-600">{form.ownerEmail ?? '—'}</TableCell>
                      <TableCell>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {statusLabel}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{form.responsesCount.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(form.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/users/${form.ownerId}/view-as`}>
                            <Button variant="outline" size="sm" title="Ver como dono" aria-label="Ver como dono">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/forms/${form.id}/responses`}>
                            <Button variant="outline" size="sm" title="Abrir respostas (admin)" aria-label="Abrir respostas">
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
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>Página {page} de {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages}>
              Próxima
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
