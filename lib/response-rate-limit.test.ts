/**
 * Isolamento dos ORÇAMENTOS de rate limit (auditoria 2026-08, lote 2 · L2-4).
 *
 * O defeito: três rotas diferentes gastavam o MESMO balde `resp:${ip}` (10/min), que é o do
 * SUBMIT FINAL. Consequência real, sem atacante nenhum: ~10 autosaves de um respondente
 * legítimo esgotavam a janela e o `POST /api/responses` do envio levava 429. O player não tem
 * retry — a resposta ficava `completed=false` e o lead virava "abandono".
 *
 * Estes testes travam a separação dos baldes na camada onde ela é decidida: as CHAVES enviadas
 * à RPC. Se alguém reapontar uma rota para o balde do submit, ou trocar uma chave, quebra aqui.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A RPC `check_rate_limit` devolve um ARRAY de linhas — não um booleano. Formato errado faz
// `checkLimitAsync` cair no fallback de memória e responder "permitido", mascarando o teste.
const permitido = () => ({ data: [{ allowed: true, current_count: 1, reset_in_ms: 60_000 }], error: null })
const negado = () => ({ data: [{ allowed: false, current_count: 99, reset_in_ms: 60_000 }], error: null })

type RpcResp = ReturnType<typeof permitido>
const rpc = vi.fn(async (_fn?: unknown, _args?: unknown): Promise<RpcResp> => permitido())
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({ rpc }),
}))

import {
  checkResponseRateLimitAsync,
  checkPartialRateLimitAsync,
  checkUploadSignRateLimitAsync,
  checkUploadSignPreflightAsync,
} from './response-rate-limit'

const IP = '203.0.113.7'
const FORM = '11111111-1111-4111-8111-111111111111'

/** Chaves + tetos que cada helper enviou à RPC nesta chamada. */
function chamadas() {
  return rpc.mock.calls.map((c) => {
    const args = (c as unknown as [string, Record<string, unknown>])[1] ?? {}
    return { key: args.p_key as string, max: args.p_max_requests as number }
  })
}

beforeEach(() => {
  rpc.mockClear()
  rpc.mockImplementation(async () => permitido())
})

describe('isolamento dos orçamentos de rate limit', () => {
  it('o SUBMIT final usa `resp:` — o balde que ninguém mais pode tocar', async () => {
    await checkResponseRateLimitAsync(IP)
    expect(chamadas()).toEqual([{ key: `resp:${IP}`, max: 10 }])
  })

  it('parciais/autosave usam `partial:` por form + `partialg:` global — NUNCA `resp:`', async () => {
    await checkPartialRateLimitAsync(IP, FORM)
    const keys = chamadas().map((c) => c.key)
    expect(keys).toContain(`partial:${IP}:${FORM}`)
    expect(keys).toContain(`partialg:${IP}`)
    // O ponto do teste: nenhuma chamada pode cair no balde do submit.
    expect(keys.some((k) => k.startsWith('resp:'))).toBe(false)
  })

  it('assinatura de upload usa `upsign:` por form + `upsigng:` global — NUNCA `resp:`', async () => {
    await checkUploadSignRateLimitAsync(IP, FORM)
    const keys = chamadas().map((c) => c.key)
    expect(keys).toContain(`upsign:${IP}:${FORM}`)
    expect(keys).toContain(`upsigng:${IP}`)
    expect(keys.some((k) => k.startsWith('resp:'))).toBe(false)
  })

  it('o pré-filtro do upload tem chave própria, distinta do balde por form', async () => {
    await checkUploadSignPreflightAsync(IP)
    const keys = chamadas().map((c) => c.key)
    expect(keys).toEqual([`upsignpre:${IP}`])
    expect(keys.some((k) => k.startsWith('resp:'))).toBe(false)
  })

  it('REGRESSÃO: gastar o orçamento dos parciais NÃO consome o do submit', async () => {
    // Nega tudo que for `partial*` e permite o resto. Se as rotas compartilhassem balde,
    // o submit herdaria a negativa — que era exatamente o bug.
    rpc.mockImplementation(async (_fn: unknown, args: unknown) => {
      const key = (args as { p_key: string }).p_key
      return key.startsWith('partial') ? negado() : permitido()
    })

    const parcial = await checkPartialRateLimitAsync(IP, FORM)
    const submit = await checkResponseRateLimitAsync(IP)

    expect(parcial.allowed).toBe(false) // parciais esgotados
    expect(submit.allowed).toBe(true) // ...e o envio final segue passando
  })

  it('REGRESSÃO: gastar o orçamento do upload NÃO consome o do submit', async () => {
    rpc.mockImplementation(async (_fn: unknown, args: unknown) => {
      const key = (args as { p_key: string }).p_key
      return key.startsWith('upsign') ? negado() : permitido()
    })

    const upload = await checkUploadSignRateLimitAsync(IP, FORM)
    const submit = await checkResponseRateLimitAsync(IP)

    expect(upload.allowed).toBe(false)
    expect(submit.allowed).toBe(true)
  })

  it('o teto GLOBAL barra spray entre formulários diferentes do mesmo IP', async () => {
    // Por-form liberado, global estourado → tem que negar. Sem isso, bastaria variar o
    // form_id para multiplicar o orçamento indefinidamente.
    rpc.mockImplementation(async (_fn: unknown, args: unknown) => {
      const key = (args as { p_key: string }).p_key
      return key.startsWith('partialg:') ? negado() : permitido()
    })
    const r = await checkPartialRateLimitAsync(IP, FORM)
    expect(r.allowed).toBe(false)
  })
})
