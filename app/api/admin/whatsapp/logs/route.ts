import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

type WhatsAppLogRow = {
  id: string
  form_id: string
  phone_number: string
  status: string
  wacli_message_id: string | null
  error_message: string | null
  timestamp: string
  /** Motor que entregou. NULO em envios anteriores a 2026-07-27 e enquanto a
   *  migração manual da coluna não tiver sido aplicada. */
  transport?: string | null
}

/**
 * Traduz o status BRUTO da tabela para o que a tela mostra.
 *
 * Exportada e testada porque o mapeamento antigo era binário ("sent" = verde,
 * resto = vermelho) e MENTIA: `abandoned_alert` é o registro do alerta de lead
 * abandonado, e quando tem `wacli_message_id` preenchido ele foi ENTREGUE com
 * sucesso — mas aparecia com bolinha vermelha, contradizendo o quadro de
 * falhas (que dizia 0, corretamente). Achado pelo Sidney em 28/07 olhando a
 * tela. `skipped` ("decidimos NÃO mandar") também virava vermelho.
 */
export function traduzirStatusLog(row: Pick<WhatsAppLogRow, 'status' | 'wacli_message_id' | 'error_message'>): {
  status: 'enviado' | 'na fila' | 'ignorado' | 'erro'
  kind: 'lead' | 'abandono'
} {
  if (row.status === 'sent') return { status: 'enviado', kind: 'lead' }
  if (row.status === 'queued') return { status: 'na fila', kind: 'lead' }
  if (row.status === 'skipped') return { status: 'ignorado', kind: 'lead' }
  if (row.status === 'abandoned_alert') {
    // Ciclo de vida do claim (ver cron abandoned-leads): id preenchido =
    // promovido = alerta entregue; sem id = pendente/na fila de reenvio.
    if (row.wacli_message_id) return { status: 'enviado', kind: 'abandono' }
    return { status: 'na fila', kind: 'abandono' }
  }
  return { status: 'erro', kind: 'lead' }
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

  // A coluna `transport` vem de migração MANUAL. Enquanto ela não for aplicada,
  // pedi-la faz o PostgREST recusar a query inteira e a tela ficaria sem NENHUM
  // log. Então tenta com a coluna e cai pro select antigo se ela não existir.
  const COLUNAS_BASE = 'id, form_id, phone_number, status, wacli_message_id, error_message, timestamp'
  let { data: logs, error: logsError } = await logsQuery
    .select(`${COLUNAS_BASE}, transport`)
    .order('timestamp', { ascending: false })
    .limit(20)

  if (logsError) {
    const semColuna = await (supabase as unknown as {
      from: (table: 'form_whatsapp_logs') => {
        select: (columns: string) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (count: number) => Promise<{ data: WhatsAppLogRow[] | null; error: { message: string } | null }>
          }
        }
      }
    }).from('form_whatsapp_logs')
      .select(COLUNAS_BASE)
      .order('timestamp', { ascending: false })
      .limit(20)
    logs = semColuna.data
    logsError = semColuna.error
  }

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

    formsById = new Map(
      (forms ?? []).map((form) => [
        form.id,
        form.title?.trim() ? form.title : `Form #${form.id.slice(0, 8)}`,
      ])
    )
  }

  return NextResponse.json({
    logs: (logs ?? []).map((log) => ({
      id: log.id,
      recipient: log.phone_number || '(sem telefone)',
      form: formsById.get(log.form_id) || 'Formulário removido',
      date: log.timestamp,
      ...traduzirStatusLog(log),
      transport: log.transport ?? null,
      errorMessage: log.error_message,
    })),
  })
}
