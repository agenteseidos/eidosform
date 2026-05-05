import { AdminFormsTable } from '@/components/admin/admin-forms-table'

export const dynamic = 'force-dynamic'

export default function AdminFormsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Formulários</h2>
        <p className="mt-1 text-sm text-slate-600">
          Visão geral de todos os formulários da plataforma. Use as ações para abrir respostas ou impersonate o dono.
        </p>
      </div>

      <AdminFormsTable />
    </div>
  )
}
