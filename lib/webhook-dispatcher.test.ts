/**
 * Disparo de webhook e aviso ao dono (auditoria 2026-08, lote 3 · L3-1, L3-2, L3-3c).
 *
 * Este arquivo NÃO existia — o módulo que entrega o lead ao CRM do cliente não tinha teste nenhum,
 * o que explica como o aviso "seu webhook parou" ficou pronto e MORTO por meses: a tabela, a RLS,
 * o template de e-mail e a função existiam, e nenhum chamador passava `ownerEmail`.
 *
 * ESTRATÉGIA — a trava anti-rajada é testada DIRETO em `maybeNotifyOwnerOfWebhookFailures`, sem
 * passar por `dispatchWebhook`. Testá-la de fora exigia atravessar 4 tentativas de rede com backoff
 * (1s+2s+4s), e o arranjo de temporizadores falsos para pular essas esperas ficou INTERMITENTE: o
 * disparo também espera `crypto.subtle.sign` e `fetch`, que não são temporizadores e só avançam
 * quando o laço de eventos real gira. Um teste que passa em 2 de 3 execuções ensina a ignorar o
 * vermelho — é pior que não ter teste. Os testes de `dispatchWebhook` aqui são só os que decidem
 * ANTES do laço de repetição, e por isso são instantâneos e determinísticos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Supabase falso, com controle fino sobre a disputa do claim -------------------------------
const estado = {
  falhas: [] as Array<Record<string, unknown>>,
  claimVence: true,       // o UPDATE condicional encontra linha com marca velha (>24h)?
  insertConflita: false,  // o INSERT bate em chave duplicada (outra execução chegou antes)?
  inserts: [] as Array<{ tabela: string; linha: Record<string, unknown> }>,
  updates: [] as Array<Record<string, unknown>>,
}

function tabelaFalsa(nome: string) {
  return {
    insert: (linha: Record<string, unknown>) => {
      estado.inserts.push({ tabela: nome, linha })
      if (nome === 'webhook_failure_notifications' && estado.insertConflita) {
        return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
      }
      return Promise.resolve({ error: null })
    },
    update: (linha: Record<string, unknown>) => {
      estado.updates.push(linha)
      return {
        eq: () => ({
          lt: () => ({
            select: () => Promise.resolve({ data: estado.claimVence ? [{ form_id: 'f1' }] : [], error: null }),
          }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        gte: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: estado.falhas, error: null }) }),
        }),
        maybeSingle: () => Promise.resolve({ data: { title: 'Meu formulário' }, error: null }),
      }),
    }),
  }
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (n: string) => tabelaFalsa(n) }) }))

const sendWebhookFailureAlert = vi.fn(async () => ({ id: 'e1' }))
vi.mock('@/lib/resend', () => ({ sendWebhookFailureAlert: () => sendWebhookFailureAlert() }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))

const urlSegura = vi.fn(async () => ({ safe: true }) as { safe: boolean; reason?: string })
vi.mock('./webhook-validator', () => ({ validateWebhookUrlAsync: () => urlSegura() }))

import { dispatchWebhook, maybeNotifyOwnerOfWebhookFailures } from './webhook-dispatcher'

const TRES_FALHAS = [
  { webhook_url: 'https://crm.cliente.com/hook', last_error: 'HTTP 500', created_at: '2026-08-07T10:00:00Z' },
  { webhook_url: 'https://crm.cliente.com/hook', last_error: 'timeout', created_at: '2026-08-07T09:00:00Z' },
  { webhook_url: 'https://crm.cliente.com/hook', last_error: 'HTTP 502', created_at: '2026-08-07T08:00:00Z' },
]

const avisar = () => maybeNotifyOwnerOfWebhookFailures({ formId: 'f1', ownerEmail: 'dono@cliente.com' })

beforeEach(() => {
  sendWebhookFailureAlert.mockClear()
  urlSegura.mockResolvedValue({ safe: true })
  estado.falhas = TRES_FALHAS
  estado.claimVence = true
  estado.insertConflita = false
  estado.inserts = []
  estado.updates = []
  process.env.WEBHOOK_SECRET = 'segredo-de-teste'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
  vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })))
})

describe('L3-1 — aviso ao dono de que o webhook parou', () => {
  it('≥3 falhas na janela e vaga reservada: o dono é avisado UMA vez', async () => {
    await avisar()
    expect(sendWebhookFailureAlert).toHaveBeenCalledTimes(1)
  })

  it('menos de 3 falhas na janela não incomoda o cliente', async () => {
    estado.falhas = TRES_FALHAS.slice(0, 2)
    await avisar()
    expect(sendWebhookFailureAlert).not.toHaveBeenCalled()
    expect(estado.updates).toHaveLength(0)
  })

  it('TRAVA ANTI-RAJADA: perder o claim (já avisado em <24h) não envia nada', async () => {
    // O cenário real: várias respostas do mesmo formulário caindo ao mesmo tempo, todas com o
    // webhook quebrado, todas rodando em paralelo dentro do `after()`. Na forma antiga — ler,
    // decidir, enviar, gravar — todas liam "sem aviso recente" e todas enviavam. O cliente recebia
    // uma enxurrada de e-mails de alerta em vez de um.
    estado.claimVence = false
    estado.insertConflita = true
    await avisar()
    expect(sendWebhookFailureAlert).not.toHaveBeenCalled()
  })

  it('primeira notificação do formulário (linha ainda não existe) passa pelo INSERT e envia', async () => {
    estado.claimVence = false
    estado.insertConflita = false
    await avisar()
    expect(estado.inserts.some((i) => i.tabela === 'webhook_failure_notifications')).toBe(true)
    expect(sendWebhookFailureAlert).toHaveBeenCalledTimes(1)
  })

  it('a marca é gravada ANTES do envio e NUNCA regravada depois', async () => {
    // Regravar depois do envio reabriria a janela: a próxima execução leria a marca antiga e
    // enviaria de novo. Aqui há exatamente uma escrita, e ela acontece antes do e-mail sair.
    await avisar()
    expect(estado.updates).toHaveLength(1)
    expect(estado.updates[0]).toMatchObject({ failure_count_window: 3 })
    expect(estado.inserts.filter((i) => i.tabela === 'webhook_failure_notifications')).toHaveLength(0)
  })

  it('sem falhas suficientes o fluxo termina em silêncio, sem lançar', async () => {
    estado.falhas = []
    await expect(avisar()).resolves.toBeUndefined()
  })
})

describe('dispatchWebhook — decisões anteriores ao laço de repetição', () => {
  it('L3-3c: URL rejeitada por SSRF deixa rastro na fila morta (antes sumia num log)', async () => {
    urlSegura.mockResolvedValue({ safe: false, reason: 'Hostname resolves to private IP addresses' })
    const r = await dispatchWebhook({
      webhookUrl: 'https://interno.local/hook', formId: 'f1', responseId: 'r1',
      responseData: {}, ownerEmail: 'dono@cliente.com',
    })
    expect(r.success).toBe(false)
    const dlq = estado.inserts.find((i) => i.tabela === 'webhook_failures')
    expect(dlq, 'rejeição por SSRF não foi registrada em lugar nenhum').toBeTruthy()
    expect(String(dlq!.linha.last_error)).toMatch(/private IP|SSRF|blocked/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sem WEBHOOK_SECRET o disparo aborta sem chamar o destino', async () => {
    delete process.env.WEBHOOK_SECRET
    const r = await dispatchWebhook({
      webhookUrl: 'https://crm.cliente.com/hook', formId: 'f1', responseId: 'r1', responseData: {},
    })
    expect(r.success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('L3-2: manda o cabeçalho de idempotência — o CRM consegue descartar repetição', async () => {
    // `X-EidosForm-Delivery-Id` é o `responseId`, que não muda dentro do laço: as 4 tentativas
    // levam o mesmo valor por construção. Aqui basta a 1ª, que responde 200 e encerra.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    const r = await dispatchWebhook({
      webhookUrl: 'https://crm.cliente.com/hook', formId: 'f1', responseId: 'r1', responseData: {},
    })
    expect(r.success).toBe(true)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ 'X-EidosForm-Delivery-Id': 'r1' })
  })

  it('sucesso na primeira tentativa não grava fila morta nem avisa ninguém', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    const r = await dispatchWebhook({
      webhookUrl: 'https://crm.cliente.com/hook', formId: 'f1', responseId: 'r1',
      responseData: {}, ownerEmail: 'dono@cliente.com',
    })
    expect(r.success).toBe(true)
    expect(estado.inserts).toHaveLength(0)
    expect(sendWebhookFailureAlert).not.toHaveBeenCalled()
  })
})

/**
 * L3-2b — o orçamento de 25s é PREVISÃO, não retrovisor (fechado na varredura de 11/08/2026).
 *
 * A checagem antiga olhava só o tempo JÁ gasto: aos 21s ela deixava passar (21 < 25), dormia 2s
 * e disparava um POST de até 10s — terminando aos 33s, além do orçamento que existe justamente
 * para sobrar tempo de gravar a fila morta antes de a função serverless morrer. O teto virava
 * decoração exatamente no pior caso, o único em que ele importa.
 *
 * O relógio aqui é um espião no Date.now — a lição do lote 3 (harness de fake-timers descartado
 * por flakiness com fetch/crypto) foi não fingir timers, só a LEITURA do tempo.
 */
describe('L3-2b — orçamento total com previsão de custo da próxima tentativa', () => {
  it('🛡️ 1ª tentativa comeu 16s → a 2ª NÃO cabe (16+1+10 ≥ 25): para com folga p/ a fila morta', async () => {
    // fetch falha instantâneo; o "tempo gasto" é simulado pelo espião.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('destino lento caiu') }))
    const spy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)        // inicio
      .mockReturnValue(16_000)       // todas as leituras seguintes: 16s decorridos

    const r = await dispatchWebhook({
      webhookUrl: 'https://crm.cliente.com/hook', formId: 'f1', responseId: 'r1',
      responseData: {}, ownerEmail: 'dono@cliente.com',
    })
    spy.mockRestore()

    expect(r.success).toBe(false)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1) // NÃO tentou a 2ª — não cabia
    const dlq = estado.inserts.find((i) => i.tabela === 'webhook_failures')
    expect(dlq, 'a fila morta é o motivo de o orçamento existir').toBeTruthy()
    expect(String(dlq!.linha.last_error)).toMatch(/não comporta/i)
  })

  it('tempo de sobra → a previsão NÃO bloqueia o retry legítimo (2ª tentativa acontece)', async () => {
    // 1ª falha rápida (1s decorrido): 1+1+10 < 25 → retry roda e é atendido.
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(new Response('ok', { status: 200 })))
    const spy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(1_000)

    const r = await dispatchWebhook({
      webhookUrl: 'https://crm.cliente.com/hook', formId: 'f1', responseId: 'r1',
      responseData: {}, ownerEmail: 'dono@cliente.com',
    })
    spy.mockRestore()

    expect(r.success).toBe(true)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(estado.inserts.find((i) => i.tabela === 'webhook_failures')).toBeFalsy()
  }, 15_000)
})
