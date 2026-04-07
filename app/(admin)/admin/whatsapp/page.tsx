import { AdminWhatsAppPanel } from '@/components/admin/admin-whatsapp-panel'

export default function AdminWhatsappPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">WhatsApp</h2>
        <p className="mt-1 text-sm text-slate-600">
          Gerencie a conexão do WhatsApp Business para envio de mensagens.
        </p>
      </div>

      <AdminWhatsAppPanel />
    </div>
  )
}
