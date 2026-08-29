/**
 * Régua do trial.
 *
 * O que estes testes trancam, em ordem de gravidade:
 *   1. mensagem NUNCA sai duas vezes (selar antes de chamar a Meta; ambíguo não reenvia);
 *   2. quem pediu para não receber não recebe — e "não sei" também não recebe (fail-closed);
 *   3. quem assinou ou expirou sai da régua;
 *   4. o teto de 30/24h é respeitado.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted: vi.mock sobe para o topo do arquivo, então os mocks precisam existir antes.
const { enviarMock, optOutMock } = vi.hoisted(() => ({
  enviarMock: vi.fn(),
  optOutMock: vi.fn(),
}))
vi.mock('@/lib/whatsapp-confirmations', () => ({
  sendConfirmationTemplate: enviarMock,
  consultarOptOut: optOutMock,
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { processarEntregasDevidas, textoDaEtapa } from './regua'
import type { SupabaseClient } from '@supabase/supabase-js'

const AGORA = new Date('2026-09-10T12:00:00Z')
const ENTREGA = {
  id: 'entrega-1',
  phone_match_key_br: '558399376704',
  stage: 'd25' as const,
  valid_until: '2026-09-12T12:00:00Z',
  attempts: 0,
}

/** Registra o que foi escrito em trial_deliveries para as asserções. */
function fakeDb(opts: {
  devidas?: unknown[]
  ledger?: unknown
  perfil?: unknown
  selagemFalha?: boolean
  usadasNa24h?: number
}) {
  const escritas: Record<string, unknown>[] = []
  const db = {
    from(tabela: string) {
      const q: Record<string, unknown> = {}
      const encadeia = () => q
      for (const m of ['select', 'eq', 'lte', 'gte', 'lt', 'or', 'order', 'in']) q[m] = encadeia
      q.limit = async () => ({ data: opts.devidas ?? [], error: null })
      q.maybeSingle = async () => ({
        data: tabela === 'plan_trials' ? opts.ledger ?? null : opts.perfil ?? null,
      })
      q.update = (valores: Record<string, unknown>) => {
        escritas.push({ tabela, ...valores })
        const u: Record<string, unknown> = {}
        for (const m of ['eq', 'lt', 'in']) u[m] = () => u
        u.select = async () => {
          if (valores.state === 'sealed' && opts.selagemFalha) return { data: [], error: { message: 'timeout' } }
          return { data: [{ id: ENTREGA.id }], error: null }
        }
        // update sem .select() (finalizações) resolve direto
        u.then = (res: (v: unknown) => void) => { res({ data: null, error: null }); return Promise.resolve({}) }
        return u
      }
      // contagem da cota
      if (tabela === 'trial_deliveries') {
        q.select = (_c: string, o?: { count?: string; head?: boolean }) => {
          if (o?.count) {
            const c = { ...q }
            c.in = () => c
            c.gte = async () => ({ count: opts.usadasNa24h ?? 0 })
            return c
          }
          return q
        }
      }
      return q
    },
  } as unknown as SupabaseClient
  return { db, escritas }
}

const LEDGER_ATIVO = { status: 'ativo', expires_at: '2026-09-27T23:59:59Z', profile_id: 'p1' }
const PERFIL = { full_name: 'Marcos Silva', phone: '5583999376704' }

describe('régua do trial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    optOutMock.mockResolvedValue('liberado')
    enviarMock.mockResolvedValue({ sent: true, wamid: 'wamid-1', desfecho: 'entregue' })
  })

  it('envia a etapa devida e registra o WAMID', async () => {
    const { db, escritas } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.enviadas).toBe(1)
    expect(enviarMock).toHaveBeenCalledOnce()
    // a etiqueta que liga o webhook de status a esta linha
    expect(enviarMock.mock.calls[0][0]).toMatchObject({ bizOpaqueCallbackData: ENTREGA.id, pularOptOut: true })
    expect(escritas.some((e) => e.state === 'sealed')).toBe(true)
    expect(escritas.some((e) => e.state === 'accepted' && e.provider_id === 'wamid-1')).toBe(true)
  })

  it('🔒 sela ANTES de chamar a Meta (é o que impede duplicar)', async () => {
    const { db, escritas } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    await processarEntregasDevidas(db, { agora: AGORA })

    const iSeal = escritas.findIndex((e) => e.state === 'sealed')
    const iAccept = escritas.findIndex((e) => e.state === 'accepted')
    expect(iSeal).toBeGreaterThanOrEqual(0)
    expect(iSeal).toBeLessThan(iAccept)
  })

  it('🔒 selagem incerta → NÃO chama a Meta', async () => {
    const { db } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL, selagemFalha: true })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(enviarMock).not.toHaveBeenCalled()
    expect(r.enviadas).toBe(0)
  })

  it('🔒 resposta ambígua da Meta → estado ambiguous, sem reenvio', async () => {
    enviarMock.mockResolvedValue({ sent: false, desfecho: 'desconhecido', skipped: 'exception' })
    const { db, escritas } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.ambiguas).toBe(1)
    expect(escritas.some((e) => e.state === 'ambiguous')).toBe(true)
    expect(escritas.some((e) => e.state === 'pending')).toBe(false)  // não volta para a fila
  })

  it('recusa explícita da Meta → volta para a fila com backoff em MINUTOS', async () => {
    enviarMock.mockResolvedValue({ sent: false, desfecho: 'recusado', graphCode: 131056, httpStatus: 429 })
    const { db, escritas } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    await processarEntregasDevidas(db, { agora: AGORA })

    const volta = escritas.find((e) => e.state === 'pending')
    expect(volta).toBeTruthy()
    const espera = new Date(volta!.next_attempt_at as string).getTime() - AGORA.getTime()
    expect(espera).toBeLessThanOrEqual(60 * 60_000)   // no máximo 1h, nunca "amanhã"
  })

  it('opt-out: não envia', async () => {
    optOutMock.mockResolvedValue('opt_out')
    const { db, escritas } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.puladas).toBe(1)
    expect(enviarMock).not.toHaveBeenCalled()
    expect(escritas.some((e) => e.state === 'skipped' && e.skip_reason === 'opt_out')).toBe(true)
  })

  it('🔒 opt-out DESCONHECIDO (Elen fora do ar) → adia, não envia', async () => {
    optOutMock.mockResolvedValue('desconhecido')
    const { db } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.adiadas).toBe(1)
    expect(enviarMock).not.toHaveBeenCalled()
  })

  it('quem assinou sai da régua', async () => {
    const { db, escritas } = fakeDb({
      devidas: [ENTREGA], ledger: { ...LEDGER_ATIVO, status: 'convertido' }, perfil: PERFIL,
    })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.puladas).toBe(1)
    expect(enviarMock).not.toHaveBeenCalled()
    expect(escritas.some((e) => e.skip_reason === 'ledger_convertido')).toBe(true)
  })

  it('etapa fora do prazo não é enviada com atraso', async () => {
    const velha = { ...ENTREGA, valid_until: '2026-09-01T00:00:00Z' }
    const { db, escritas } = fakeDb({ devidas: [velha], ledger: LEDGER_ATIVO, perfil: PERFIL })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.puladas).toBe(1)
    expect(escritas.some((e) => e.skip_reason === 'etapa_vencida')).toBe(true)
  })

  it('teto de 30 em 24h: cheio → adia sem enviar', async () => {
    const { db } = fakeDb({ devidas: [ENTREGA], ledger: LEDGER_ATIVO, perfil: PERFIL, usadasNa24h: 30 })
    const r = await processarEntregasDevidas(db, { agora: AGORA })

    expect(r.adiadas).toBe(1)
    expect(enviarMock).not.toHaveBeenCalled()
  })
})

describe('textos das etapas', () => {
  const expira = new Date('2026-09-27T23:59:59-03:00')

  it('usam "seu acesso ao plano Plus" e cabem no limite do parâmetro', () => {
    for (const etapa of ['d0', 'd15', 'd25', 'd30'] as const) {
      const t = textoDaEtapa(etapa, expira)
      expect(t.length).toBeLessThan(190)
      expect(t).not.toContain('—')          // travessão é proibido na comunicação do produto
    }
    expect(textoDaEtapa('d0', expira)).toContain('acesso ao plano Plus')
    expect(textoDaEtapa('d15', expira)).toContain('acesso ao plano Plus')
    expect(textoDaEtapa('d25', expira)).toContain('27/09')
  })
})
