import { AdminUsersTable } from '@/components/admin/admin-users-table'

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Usuários</h2>
        <p className="mt-1 text-sm text-slate-600">Busque usuários e ajuste planos sem sair do painel.</p>
      </div>

      <AdminUsersTable />
    </div>
  )
}
