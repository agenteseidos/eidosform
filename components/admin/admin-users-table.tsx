"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PLAN_ORDER, PlanId } from '@/lib/plans'

type AdminUser = {
  id: string
  email: string
  plan: PlanId
  planCycle: string | null
  planExpiresAt: string | null
  planStatus: string | null
  lifetimeAccess: boolean
  hasSubscription: boolean
  responsesUsed: number
  responsesLimit: number
  createdAt: string
  formsCount: number
}

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  starter: 'Starter',
  plus: 'Plus',
  professional: 'Professional',
}

/** Formats an ISO timestamp into an <input type="date"> value (YYYY-MM-DD). */
function isoToDateInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** YYYY-MM-DD for today + days (local), for the +7/+30/+90 shortcuts. */
function dateInputPlusDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return isoToDateInput(date.toISOString())
}

/**
 * Origem da conta, na ordem de precedência: vitalícia > assinatura > grant.
 * "Grant" = plano pago concedido manualmente, sem cobrança no Asaas.
 */
function accountOrigin(user: AdminUser): 'lifetime' | 'subscription' | 'grant' | 'free' {
  if (user.lifetimeAccess) return 'lifetime'
  if (user.plan === 'free') return 'free'
  if (user.hasSubscription) return 'subscription'
  return 'grant'
}

const CYCLE_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  canceling: { label: 'Cancelando', className: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Cancelado', className: 'bg-slate-200 text-slate-600' },
  expired: { label: 'Expirado', className: 'bg-red-100 text-red-700' },
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
  const [nextExpiresOn, setNextExpiresOn] = useState<string>('') // YYYY-MM-DD
  const [reason, setReason] = useState('')
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [dialogWarnings, setDialogWarnings] = useState<string[]>([])
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
    setNextExpiresOn(isoToDateInput(user.planExpiresAt))
    setReason('')
    setNotifyCustomer(true)
    setDialogWarnings([])
  }

  async function handleSavePlan() {
    if (!selectedUser) return

    try {
      setSaving(true)
      setError(null)
      setDialogWarnings([])

      const response = await fetch(`/api/admin/users/${selectedUser.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: nextPlan,
          // O servidor converte YYYY-MM-DD para fim do dia BRT (não depende do
          // fuso do navegador do admin). Free não envia data.
          ...(nextPlan !== 'free' && nextExpiresOn ? { expiresOn: nextExpiresOn } : {}),
          reason: reason.trim(),
          notifyCustomer,
        }),
      })

      const json = await response.json().catch(() => null) as
        | { success?: boolean; user?: AdminUser | null; warnings?: string[]; error?: string }
        | null

      if (!response.ok) {
        throw new Error(json?.error || 'Falha ao atualizar plano')
      }

      // Estado CANÔNICO relido do banco — nunca update otimista (a conta
      // vitalícia, por exemplo, é revertida por trigger e a UI mentia sucesso).
      if (json?.user) {
        const canonical = json.user
        setUsers((current) => current.map((user) => (
          user.id === canonical.id ? { ...user, ...canonical } : user
        )))
      }

      if (json?.warnings?.length) {
        setDialogWarnings(json.warnings)
      } else {
        setSelectedUser(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar plano')
    } finally {
      setSaving(false)
    }
  }

  const reasonTooShort = reason.trim().length < 5
  const needsDate = nextPlan !== 'free' && !nextExpiresOn

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
                  <TableHead>Plano</TableHead>
                  <TableHead>Ciclo</TableHead>
                  <TableHead>Expiração</TableHead>
                  <TableHead className="hidden md:table-cell">Uso do mês</TableHead>
                  <TableHead className="hidden sm:table-cell">Forms</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length > 0 ? (
                  users.map((user) => {
                    const expiresAt = user.planExpiresAt ? new Date(user.planExpiresAt) : null
                    const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() : false
                    const origin = accountOrigin(user)
                    // Pago + sem data + não vitalícia = grant eterno por omissão.
                    // O backend agora rejeita criar novos; legados aparecem como anomalia.
                    const isAnomaly = user.plan !== 'free' && !expiresAt && !user.lifetimeAccess
                    const statusBadge = user.planStatus ? STATUS_BADGES[user.planStatus] : undefined
                    return (
                      <TableRow key={user.id} className={isAnomaly ? 'bg-red-50/50' : undefined}>
                        <TableCell className="max-w-[200px] sm:max-w-[260px] truncate font-medium text-slate-900">{user.email}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {PLAN_LABELS[user.plan]}
                            </span>
                            {origin === 'lifetime' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700" title="Acesso vitalício — não alterável pelo painel">
                                <ShieldCheck className="h-3 w-3" /> Vitalícia
                              </span>
                            )}
                            {origin === 'grant' && (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700" title="Plano pago concedido manualmente — sem cobrança no Asaas">
                                Grant
                              </span>
                            )}
                            {origin === 'subscription' && (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700" title="Assinatura ativa no Asaas">
                                Assinatura
                              </span>
                            )}
                            {statusBadge && user.planStatus !== 'active' && (
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
                                {statusBadge.label}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-slate-700">
                          {user.plan === 'free'
                            ? <span className="text-slate-400">—</span>
                            : user.planCycle
                              ? (CYCLE_LABELS[user.planCycle] ?? user.planCycle)
                              : origin === 'lifetime'
                                ? <span className="text-slate-400">—</span>
                                : <span className="text-violet-600">Manual</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {user.plan === 'free' ? (
                            <span className="text-slate-400">—</span>
                          ) : user.lifetimeAccess ? (
                            <span className="text-emerald-700">Nunca expira</span>
                          ) : expiresAt ? (
                            <span className={isExpired ? 'text-red-600' : 'text-slate-700'}>
                              {expiresAt.toLocaleDateString('pt-BR')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600" title="Plano pago sem expiração e sem marca de vitalício — corrigir">
                              <TriangleAlert className="h-3.5 w-3.5" /> Sem expiração
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell whitespace-nowrap text-sm text-slate-600">
                          {user.responsesUsed}/{user.responsesLimit === -1 ? '∞' : user.responsesLimit}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{user.formsCount}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/admin/users/${user.id}/view-as`}>
                              <Button variant="outline" size="sm" className="min-h-[44px]" title="Ver como dono" aria-label="Ver como dono">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-[44px]"
                              onClick={() => openPlanDialog(user)}
                              disabled={user.lifetimeAccess}
                              title={user.lifetimeAccess ? 'Conta vitalícia — alterável só via SQL (por desenho)' : undefined}
                            >
                              Alterar plano
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
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
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alterar plano</DialogTitle>
            <DialogDescription>
              {selectedUser ? `Atualize o plano de ${selectedUser.email}.` : 'Selecione um plano.'}
            </DialogDescription>
          </DialogHeader>

          {selectedUser?.hasSubscription && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Este usuário tem <strong>assinatura ativa no Asaas</strong>.{' '}
              {selectedUser.planCycle === 'YEARLY'
                ? 'Assinatura ANUAL: ajuste de data segue bloqueado (gateway não caracterizado). Troca de plano é pelo próprio usuário em /billing.'
                : 'Ajuste de DATA é sincronizado: move a cobrança pendente e a assinatura no Asaas junto (Fase 4). Troca de PLANO segue pelo próprio usuário em /billing (proração).'}
            </p>
          )}

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
              <label className="text-sm font-medium text-slate-700">Expiração do plano (obrigatória)</label>
              <Input
                type="date"
                value={nextExpiresOn}
                onChange={(event) => setNextExpiresOn(event.target.value)}
                min={dateInputPlusDays(1)}
                className="bg-white"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresOn(dateInputPlusDays(7))}>
                  +7 dias
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresOn(dateInputPlusDays(30))}>
                  +30 dias
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNextExpiresOn(dateInputPlusDays(90))}>
                  +90 dias
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                {nextExpiresOn
                  ? `Acesso até o FIM do dia ${new Date(`${nextExpiresOn}T12:00:00`).toLocaleDateString('pt-BR')} (horário de Brasília); depois reverte para Free.`
                  : 'Plano pago sem expiração não é permitido — só a conta vitalícia.'}
              </p>
            </div>
          )}

          {nextPlan === 'free' && (
            <p className="text-xs text-slate-500">
              Planos Free não têm expiração. A data atual será removida ao salvar.
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Motivo (obrigatório)</label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder='Ex.: "cortesia de 15 dias — atraso no suporte"'
              rows={2}
              className="bg-white"
            />
            <p className="text-xs text-slate-500">Fica registrado no histórico de ações do admin.</p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(event) => setNotifyCustomer(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span>
              Avisar o cliente (WhatsApp + e-mail)
              <span className="block text-xs text-slate-500">
                Os dois canais são espelho. Desmarque apenas para testes ou ajustes internos. A escolha fica no histórico.
              </span>
            </span>
          </label>

          {dialogWarnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {dialogWarnings.map((warning) => (
                <p key={warning}>⚠️ {warning}</p>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedUser(null)} disabled={saving}>
              {dialogWarnings.length > 0 ? 'Fechar' : 'Cancelar'}
            </Button>
            <Button onClick={handleSavePlan} disabled={saving || !selectedUser || reasonTooShort || needsDate}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
