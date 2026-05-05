import { AdminResponsesTable } from '@/components/admin/admin-responses-table'

export const dynamic = 'force-dynamic'

export default function AdminResponsesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Respostas</h2>
        <p className="mt-1 text-sm text-slate-600">
          Lista global de respostas recebidas em todos os formulários da plataforma.
        </p>
      </div>

      <AdminResponsesTable />
    </div>
  )
}
