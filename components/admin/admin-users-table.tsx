"use client"

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PLAN_ORDER, PlanId } from '@/lib/plans'

type AdminUser = {
  id: string
  email: string
  plan: PlanId
  planExpiresAt: string | null
  planStatus: string | null
  createdAt: string
  formsCount: number
}

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  starter: 'Starter',
  plus: 'Plus',
  professional: 'Professional',
}

/**
 * Formats an ISO timestamp into a HTML <input type="date"> compatible
 * value (YYYY-MM-DD), respecting the current local timezone.
 */
function isoToDateInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Returns YYYY-MM-DD for `today + days` in local time, suitable for
 * the date input shortcuts (+7, +30, +90).
 */
function dateInputPlusDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return isoToDateInput(date.toISOString())
}

/**
 * Converts a YYYY-MM-DD value from a date input into a UTC ISO string.
 * Anchored at end-of-day local time so that the plan stays valid through
 * the entire selected day before flipping to expired.
 */
function dateInputToIso(value: string): string | null {
  if (!value) return null
  const [yearStr, monthStr, dayStr] = value.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day, 23, 59, 59, 999)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function AdminUsersTable() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [nextPlan, setNextPlan] = useState<PlanId>('free')
  const [nextExpiresAt, setNextExpiresAt] = useState<string>('') // YYYY-MM-DD or '' for no expiration
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setServerSearch(search.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    let active = true

    async function loadUsers() {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams()
        if (serverSearch) params.set('search', serverSearch)
        params.set('page', String(page))
        params.set('limit', '20')

        const response = await fetch(`/api/admin/users${params.toString() ? `?${params.toString()}` : ''}`, {
          cache: 'no-store',
        })

        if (!response.ok) throw new Error('Falha ao carregar usuários')

        const json = await response.json() as { users: AdminUser[]; total: number }
        if (active) {
          setUsers(json.users)
          setTotal(json.total ?? json.users.length)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar usuários')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadUsers()
    return () => {
      active = false
    }
  }, [serverSearch, page])

  const emptyMessage = useMemo(() => {
    if (loading) return 'Carregando usuários...'
    if (error) return error
    if (serverSearch) return 'Nenhum usuário encontrado para essa busca.'
    return 'Nenhum usuário encontrado.'
  }, [error, loading, serverSearch])

  const totalPages = Math.max(1, Math.ceil(total / 20))

  function openPlanDialog(user: AdminUser) {
    setSelectedUser(user)
    setNextPlan(user.plan)
    setNextExpiresAt(isoToDateInput(user.planExpiresAt))
  }

  async function handleSavePlan() {
    if (!selectedUser) return

    try {
      setSaving(true)
      setError(null)

      // For Free plan, expiration is always cleared server-side.
      // For other plans: '' => null (no expiration), date => ISO string.
      const expiresAtPayload =
        nextPlan === 'free'
          ? null
          : nextExpiresAt
            ? dateInputToIso(nextExpiresAt)
            : null

      const response = await fetch(`/api/admin/users/${selectedUser.id}/plan`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: nextPlan,
          expiresAt: expiresAtPayload,
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao atualizar plano')
      }

      setUsers((current) => current.map((user) => (
        user.id === selectedUser.id
          ? { ...user, plan: nextPlan, planExpiresAt: expiresAtPayload }
          : user
      )))
      setSelectedUser(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar plano')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="border-slate-200 bg-white">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por e-mail"
                className="pl-9"
              />
            </div>

            <p className="text-sm text-slate-500">
              {loading ? 'Carregando...' : `${total} usuário(s)`}
            </p>
          </div>

          <div className="overflow-x-auto -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Plano atual</TableHead>
                  <TableHead>Expiração</TableHead>
                  <TableHead>Criação</TableHead>
                  <TableHead className="hidden sm:table-cell">Nº de forms</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length > 0 ? (
                  users.map((user) => {
                    const expiresAt = user.planExpiresAt ? new Date(user.planExpiresAt) : null
                    const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() : false
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="max-w-[200px] sm:max-w-[280px] truncate font-medium text-slate-900">{user.email}</TableCell>
                        <TableCell>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {PLAN_LABELS[user.plan]}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {user.plan === 'free' ? (
                            <span className="text-slate-400">—</span>
                          ) : expiresAt ? (
                            <span className={isExpired ? 'text-red-600' : 'text-slate-700'}>
                              {expiresAt.toLocaleDateString('pt-BR')}
                            </span>
                          ) : (
                            <span className="text-slate-400">Sem expiração</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                        <TableCell className="hidden sm:table-cell">{user.formsCount}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => openPlanDialog(user)}>
                            Alterar plano
                          </Button>
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

      <Dialog open={Boolean(selectedUser)} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar plano</DialogTitle>
            <DialogDescription>
              {selectedUser ? `Atualize o plano de ${selectedUser.email}.` : 'Selecione um plano.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Novo plano</label>
            <Select value={nextPlan} onValueChange={(value) => setNextPlan(value as PlanId)}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder="Selecione um plano" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_ORDER.map((plan) => (
                  <SelectItem key={plan} value={plan}>
                    {PLAN_LABELS[plan]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {nextPlan !== 'free' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Expiração do plano</label>
              <Input
                type="date"
                value={nextExpiresAt}
                onChange={(event) => setNextExpiresAt(event.target.value)}
                min={dateInputPlusDays(1)}
                className="bg-white"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresAt(dateInputPlusDays(7))}>
                  +7 dias
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresAt(dateInputPlusDays(30))}>
                  +30 dias
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresAt(dateInputPlusDays(90))}>
                  +90 dias
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresAt('')}>
                  Sem expiração
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                {nextExpiresAt
                  ? `Plano expirará em ${new Date(dateInputToIso(nextExpiresAt) ?? Date.now()).toLocaleDateString('pt-BR')} (revertendo para Free).`
                  : 'Plano não expirará automaticamente.'}
              </p>
            </div>
          )}

          {nextPlan === 'free' && (
            <p className="text-xs text-slate-500">
              Planos Free não têm expiração. A data atual será removida ao salvar.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedUser(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSavePlan} disabled={saving || !selectedUser}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
