import { AdminMetricsCards } from '@/components/admin/admin-metrics-cards'

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Métricas gerais</h2>
        <p className="mt-1 text-sm text-slate-600">Visão rápida da operação inteira do EidosForm.</p>
      </div>

      <AdminMetricsCards
        items={[
          {
            key: 'users',
            title: 'Total de usuários',
            valueKey: 'totalUsers',
          },
          {
            key: 'forms',
            title: 'Total de forms',
            valueKey: 'totalForms',
          },
          {
            key: 'responses',
            title: 'Total de respostas',
            valueKey: 'totalResponses',
          },
        ]}
      />
    </div>
  )
}
