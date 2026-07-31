import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { traduzirStatusLog } from './route'

describe('tradução de status dos Últimos envios', () => {
  it('REGRESSÃO (achada pelo Sidney 28/07): alerta de abandono ENTREGUE não é erro', () => {
    // O caso real da bolinha vermelha: 5561999848536, abandoned_alert com
    // messageId preenchido = entregue via wuzapi às 16:37. O quadro de falhas
    // dizia 0 (correto) e a bolinha dizia vermelho (mentira do mapeamento
    // binário "sent ou erro").
    expect(traduzirStatusLog({
      status: 'abandoned_alert',
      wacli_message_id: 'DCC33E1D751DEE710224D2CA6EAFB2A1',
      error_message: null,
    })).toEqual({ status: 'enviado', kind: 'abandono' })
  })

  it('alerta de abandono ainda pendente/na fila fica âmbar, não vermelho', () => {
    expect(traduzirStatusLog({
      status: 'abandoned_alert', wacli_message_id: null, error_message: null,
    })).toEqual({ status: 'na fila', kind: 'abandono' })
    expect(traduzirStatusLog({
      status: 'abandoned_alert', wacli_message_id: null, error_message: 'na fila de reenvio da VPS',
    })).toEqual({ status: 'na fila', kind: 'abandono' })
  })

  it('REGRESSÃO (saga Karin, 31/07): bloqueio operacional NÃO é "enviado"', () => {
    // O bug que este teste impede: 'bloqueado' é uma string TRUTHY, então sem
    // o desvio explícito ela cai no mesmo `if (row.wacli_message_id)` que
    // marca "enviado" — mostrando bolinha verde pra um lead que NUNCA saiu.
    // É a MESMA classe de mentira binária que o teste acima (28/07) corrigiu,
    // só que na direção oposta (falso "enviado" em vez de falso "erro").
    expect(traduzirStatusLog({
      status: 'abandoned_alert',
      wacli_message_id: 'bloqueado',
      error_message: 'Bloqueado operacionalmente (WHATSAPP_NUNCA_ENVIAR) — repassar manualmente',
    })).toEqual({ status: 'ignorado', kind: 'abandono' })
  })

  it('skipped = "decidimos não mandar", não é erro', () => {
    expect(traduzirStatusLog({
      status: 'skipped', wacli_message_id: null, error_message: 'whatsapp desligado no form',
    }).status).toBe('ignorado')
  })

  it('estados simples continuam como eram', () => {
    expect(traduzirStatusLog({ status: 'sent', wacli_message_id: 'X', error_message: null }).status).toBe('enviado')
    expect(traduzirStatusLog({ status: 'queued', wacli_message_id: null, error_message: null }).status).toBe('na fila')
    expect(traduzirStatusLog({ status: 'failed', wacli_message_id: null, error_message: 'boom' }).status).toBe('erro')
  })
})
