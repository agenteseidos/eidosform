import { describe, it, expect, vi } from 'vitest'
import { createOutbox, backoffFor } from './outbox.js'
import { createIdempotencyStore } from './idempotency.js'

function relogio(inicio = 1_000_000) {
  let t = inicio
  return { now: () => t, avanca: (ms) => { t += ms } }
}

describe('fila de reenvio', () => {
  it('falha NÃO descarta mais a notificação — ela fica na fila', async () => {
    const c = relogio()
    const fila = createOutbox({ now: c.now })
    expect(await fila.enqueue({ key: 'lead:1', to: '55', message: 'oi', error: 'transporte_fora' }))
      .toBe('enqueued')
    expect(fila.snapshot().pending).toBe(1)
  })

  it('só fica pronta para reenvio depois do backoff', async () => {
    const c = relogio()
    const fila = createOutbox({ now: c.now })
    await fila.enqueue({ key: 'lead:1', to: '55', message: 'oi' })
    expect(fila.due()).toHaveLength(0)
    c.avanca(backoffFor(1))
    expect(fila.due().map((i) => i.key)).toEqual(['lead:1'])
  })

  it('backoff cresce a cada tentativa falha', async () => {
    const c = relogio()
    const fila = createOutbox({ now: c.now })
    await fila.enqueue({ key: 'lead:1', to: '55', message: 'oi' })
    c.avanca(backoffFor(1))
    await fila.settle('lead:1', { success: false, error: 'x' })
    expect(fila.due()).toHaveLength(0)
    c.avanca(backoffFor(2))
    expect(fila.due()).toHaveLength(1)
  })

  it('entrega remove da fila', async () => {
    const c = relogio()
    const fila = createOutbox({ now: c.now })
    await fila.enqueue({ key: 'lead:1', to: '55', message: 'oi' })
    expect(await fila.settle('lead:1', { success: true })).toBe('delivered')
    expect(fila.snapshot().pending).toBe(0)
  })

  it('ENFILEIRAR É IDEMPOTENTE — é isto que mata o martelo do cron', async () => {
    // Em 27/07 o cron de abandonado retentou o MESMO lead 35 vezes contra um
    // transporte quebrado, porque a chave era liberada a cada falha.
    const c = relogio()
    const fila = createOutbox({ now: c.now })
    await fila.enqueue({ key: 'abandoned:1', to: '55', message: 'oi' })
    for (let i = 0; i < 34; i++) {
      expect(await fila.enqueue({ key: 'abandoned:1', to: '55', message: 'oi' })).toBe('already_queued')
    }
    expect(fila.snapshot().pending).toBe(1)
  })

  it('desiste depois do teto e vira carta morta (que alerta uma vez só)', async () => {
    const c = relogio()
    const fila = createOutbox({ now: c.now, maxAttempts: 3 })
    await fila.enqueue({ key: 'lead:1', to: '55', message: 'oi' })
    expect(await fila.settle('lead:1', { success: false })).toBe('retry')
    expect(await fila.settle('lead:1', { success: false })).toBe('retry')
    expect(await fila.settle('lead:1', { success: false, error: 'morreu' })).toBe('dead')
    expect(fila.snapshot()).toEqual(expect.objectContaining({ pending: 0, dead: 1 }))

    expect(await fila.takeUnalertedDead()).toHaveLength(1)
    expect(await fila.takeUnalertedDead()).toHaveLength(0) // não re-alerta
    expect(fila._dead()).toHaveLength(1) // mas a evidência PERMANECE
  })

  it('erro permanente vai direto pra carta morta, sem gastar tentativa', async () => {
    const fila = createOutbox({ now: relogio().now })
    await fila.killNow({ key: 'lead:1', to: '55', error: 'destinatario_invalido' })
    expect(fila.snapshot()).toEqual(expect.objectContaining({ pending: 0, dead: 1 }))
  })

  it('sobrevive ao restart do processo', async () => {
    const arquivo = `/tmp/claude-0/-home/4cc049d7-7214-4c38-9920-899a6df05174/scratchpad/outbox-test-${process.pid}.json`
    const a = createOutbox({ file: arquivo })
    await a.enqueue({ key: 'lead:1', to: '55', message: 'sobrevive' })
    await a.save()

    const b = createOutbox({ file: arquivo })
    b.load()
    expect(b.snapshot().pending).toBe(1)
    expect(b.has('lead:1')).toBe(true)
  })

  it('não cresce sem limite', async () => {
    const fila = createOutbox({ now: relogio().now, maxItems: 2 })
    expect(await fila.enqueue({ key: 'a', to: '55', message: 'x' })).toBe('enqueued')
    expect(await fila.enqueue({ key: 'b', to: '55', message: 'x' })).toBe('enqueued')
    expect(await fila.enqueue({ key: 'c', to: '55', message: 'x' })).toBe('full')
  })
})

describe('reentrega não pode duplicar', () => {
  it('depois de reentregar, o cron pedindo de novo é suprimido', async () => {
    // O `run` apaga a chave quando a tentativa falha. Sem o `remember`, o cron
    // voltaria 15 min depois e o Sidney receberia a mesma notificação 2×.
    const idemp = createIdempotencyStore({ file: null })
    const envio = vi.fn(async () => ({ success: false, error: 'fora' }))

    expect((await idemp.run('abandoned:1', envio)).status).toBe('failed')
    expect(idemp.get('abandoned:1')).toBeUndefined() // chave liberada

    await idemp.remember('abandoned:1', 'MSG-REENTREGUE', { transport: 'wuzapi' })

    const depois = await idemp.run('abandoned:1', envio)
    expect(depois).toEqual({ status: 'duplicate', messageId: 'MSG-REENTREGUE' })
    expect(envio).toHaveBeenCalledTimes(1) // não tentou de novo
  })

  it('falha devolve a CLASSE do erro para o chamador decidir fila × carta morta', async () => {
    const idemp = createIdempotencyStore({ file: null })
    const r = await idemp.run('k', async () => ({
      success: false, error: 'destinatario_invalido', errorClass: 'PERMANENTE',
    }))
    expect(r.raw).toEqual(expect.objectContaining({ errorClass: 'PERMANENTE' }))
  })
})
