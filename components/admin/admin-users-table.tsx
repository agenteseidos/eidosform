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
  createdAt: string
  formsCount: number
}

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  starter: 'Starter',
  plus: 'Plus',
  professional: 'Professional',
}

export function AdminUsersTable() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [nextPlan, setNextPlan] = useState<PlanId>('free')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => setServerSearch(search.trim()), 250)
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

        const response = await fetch(`/api/admin/users${params.toString() ? `?${params.toString()}` : ''}`, {
          cache: 'no-store',
        })

        if (!response.ok) throw new Error('Falha ao carregar usuários')

        const json = await response.json() as { users: AdminUser[] }
        if (active) setUsers(json.users)
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
  }, [serverSearch])

  const emptyMessage = useMemo(() => {
    if (loading) return 'Carregando usuários...'
    if (error) return error
    if (serverSearch) return 'Nenhum usuário encontrado para essa busca.'
    return 'Nenhum usuário encontrado.'
  }, [error, loading, serverSearch])

  function openPlanDialog(user: AdminUser) {
    setSelectedUser(user)
    setNextPlan(user.plan)
  }

  async function handleSavePlan() {
    if (!selectedUser) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch(`/api/admin/users/${selectedUser.id}/plan`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: nextPlan,
        }),
      })

      if (!response.ok) throw new Error('Falha ao atualizar plano')

      setUsers((current) => current.map((user) => (
        user.id === selectedUser.id ? { ...user, plan: nextPlan } : user
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
              {loading ? 'Carregando...' : `${users.length} usuário(s)`}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Plano atual</TableHead>
                <TableHead>Criação</TableHead>
                <TableHead>Nº de forms</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length > 0 ? (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="max-w-[280px] truncate font-medium text-slate-900">{user.email}</TableCell>
                    <TableCell>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {PLAN_LABELS[user.plan]}
                      </span>
                    </TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell>{user.formsCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" onClick={() => openPlanDialog(user)}>
                        Alterar plano
                      </Button>
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
