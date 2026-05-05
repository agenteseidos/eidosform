"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type AdminResponse = {
  id: string
  formId: string
  formTitle: string
  ownerId: string | null
  ownerEmail: string | null
  completed: boolean
  createdAt: string
}

export function AdminResponsesTable({ initialForm = '' }: { initialForm?: string } = {}) {
  const [responses, setResponses] = useState<AdminResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let active = true

    async function loadResponses() {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams()
        if (initialForm) params.set('form', initialForm)
        params.set('page', String(page))
        params.set('limit', '20')

        const response = await fetch(`/api/admin/responses?${params.toString()}`, { cache: 'no-store' })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.detail || body?.error || 'Falha ao carregar respostas')
        }

        const json = await response.json() as { responses: AdminResponse[]; total: number }
        if (active) {
          setResponses(json.responses)
          setTotal(json.total ?? json.responses.length)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar respostas')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadResponses()
    return () => {
      active = false
    }
  }, [page, initialForm])

  const emptyMessage = useMemo(() => {
    if (loading) return 'Carregando respostas...'
    if (error) return error
    return 'Nenhuma resposta encontrada.'
  }, [error, loading])

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <Card className="border-slate-200 bg-white">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {loading ? 'Carregando...' : `${total} resposta(s)`}
          </p>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Formulário</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recebida em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {responses.length > 0 ? (
                responses.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[260px] truncate font-medium text-slate-900">{row.formTitle}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-slate-600">{row.ownerEmail ?? '—'}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.completed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {row.completed ? 'Completa' : 'Parcial'}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(row.createdAt).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/forms/${row.formId}/responses`}>
                          <Button variant="outline" size="sm" title="Ver respostas do form" aria-label="Ver respostas">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
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
