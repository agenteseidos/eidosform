import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

type WhatsAppLogRow = {
  id: string
  form_id: string
  phone_number: string
  status: string
  error_message: string | null
  timestamp: string
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()
  const logsQuery = (supabase as unknown as {
    from: (table: 'form_whatsapp_logs') => {
      select: (columns: string) => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => Promise<{ data: WhatsAppLogRow[] | null; error: { message: string } | null }>
        }
      }
    }
  }).from('form_whatsapp_logs')

  const { data: logs, error: logsError } = await logsQuery
    .select('id, form_id, phone_number, status, error_message, timestamp')
    .order('timestamp', { ascending: false })
    .limit(20)

  if (logsError) {
    return NextResponse.json({ error: 'Failed to load WhatsApp logs' }, { status: 500 })
  }

  const formIds = Array.from(new Set((logs ?? []).map((log) => log.form_id).filter(Boolean)))

  let formsById = new Map<string, string>()

  if (formIds.length > 0) {
    const { data: forms, error: formsError } = await supabase
      .from('forms')
      .select('id, title')
      .in('id', formIds)

    if (formsError) {
      return NextResponse.json({ error: 'Failed to load WhatsApp logs' }, { status: 500 })
    }

    formsById = new Map((forms ?? []).map((form) => [form.id, form.title || 'Formulário sem título']))
  }

  return NextResponse.json({
    logs: (logs ?? []).map((log) => ({
      id: log.id,
      recipient: log.phone_number,
      form: formsById.get(log.form_id) || 'Formulário removido',
      date: log.timestamp,
      status: log.status === 'sent' ? 'enviado' : 'erro',
      errorMessage: log.error_message,
    })),
  })
}
