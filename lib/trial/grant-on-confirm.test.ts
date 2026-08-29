/**
 * Concessão do trial na confirmação do e-mail.
 *
 * O que estes testes trancam: quem veio de uma campanha NUNCA recebe a mensagem genérica de
 * "cadastro confirmado" — nem quando a concessão falha. Receber "bem-vindo" no lugar do aviso
 * de acesso liberado (ou depois de perder o acesso por prazo) é pior que não receber nada.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
const lockMocks = vi.hoisted(() => ({
  acquireLock: vi.fn<() => Promise<string | null>>(async () => 'tok-test'),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}))
vi.mock('@/lib/billing-lock', () => lockMocks)
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { concederTrialNaConfirmacao } from './grant-on-confirm'

/** from('plan_trials')/from('trial_signup_intents') → { data } configurável por tabela. */
function comTabelas(resultados: Record<string, unknown>) {
  fromMock.mockImplementation((tabela: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: resultados[tabela] ?? null })
    return chain
  })
}

const USER = 'user-1'

describe('trial na confirmação do e-mail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lockMocks.acquireLock.mockResolvedValue('tok-test')
  })

  it('conta comum: não é trial e a mensagem genérica segue valendo', async () => {
    comTabelas({})
    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r.ehTrial).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('com ledger pendente: concede e suprime a genérica', async () => {
    comTabelas({ plan_trials: { status: 'pendente_confirmacao' } })
    rpcMock.mockResolvedValue({ data: { ok: true, expires_at: '2026-09-27T23:59:59-03:00' }, error: null })

    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r).toMatchObject({ ehTrial: true, concedido: true })
    expect(rpcMock).toHaveBeenCalledWith('grant_trial', { p_profile_id: USER, p_owner_token: 'tok-test' })
    expect(lockMocks.releaseLock).toHaveBeenCalledWith(expect.anything(), `activation:${USER}`, 'tok-test')
  })

  it('🔧 recuperação: sem ledger, mas o metadata aponta um cadastro reservado → vincula e concede', async () => {
    // Cenário real: a conta foi criada e o processo morreu antes de gravar o vínculo.
    comTabelas({})
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'trial_signup_bind') return { data: { ok: true }, error: null }
      return { data: { ok: true, expires_at: '2026-09-27T23:59:59-03:00' }, error: null }
    })

    const r = await concederTrialNaConfirmacao(USER, { trial_intent: 'intent-123' })
    expect(r.ehTrial).toBe(true)
    expect(r.concedido).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('trial_signup_bind', { p_intent_id: 'intent-123', p_user_id: USER })
  })

  it('lock ocupado (pagamento ativando agora): não concede, mas continua sendo trial', async () => {
    comTabelas({ plan_trials: { status: 'pendente_confirmacao' } })
    lockMocks.acquireLock.mockResolvedValue(null)

    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r).toMatchObject({ ehTrial: true, concedido: false, motivo: 'lock_ocupado' })
    expect(rpcMock).not.toHaveBeenCalledWith('grant_trial', expect.anything())
  })

  it('prazo de confirmação vencido: recusa, mas a genérica CONTINUA suprimida', async () => {
    comTabelas({ plan_trials: { status: 'pendente_confirmacao' } })
    rpcMock.mockResolvedValue({ data: { ok: false, motivo: 'prazo_de_confirmacao_vencido' }, error: null })

    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r.ehTrial).toBe(true)      // ← o que suprime a mensagem
    expect(r.concedido).toBe(false)
    expect(r.motivo).toBe('prazo_de_confirmacao_vencido')
  })

  it('erro inesperado não derruba a confirmação do e-mail', async () => {
    fromMock.mockImplementation(() => { throw new Error('banco fora') })
    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r.ehTrial).toBe(false)     // fail-safe: confirma o e-mail normalmente
  })

  it('já concedido antes: idempotente, sem conceder de novo', async () => {
    comTabelas({ plan_trials: { status: 'ativo' } })
    rpcMock.mockResolvedValue({ data: { ok: true, ja_concedido: true, expires_at: '2026-09-27T23:59:59-03:00' }, error: null })

    const r = await concederTrialNaConfirmacao(USER, {})
    expect(r).toMatchObject({ ehTrial: true, concedido: true })
  })
})
