import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIdempotencyStore } from './idempotency.js'

/**
 * A "ponta solta" que faltava: concorrência do transporte nunca teve teste.
 * P1-8 (waiters viravam titulares em massa) chegou a produção sem nada quebrar.
 */

/** Drena TODAS as microtasks pendentes (a cadeia interna tem vários .then). */
const flush = () => new Promise((r) => setTimeout(r, 0))

/** Envio controlável: resolve quando MANDAMOS, não quando o relógio quiser. */
function envioManual() {
  const chamadas = []
  const fn = vi.fn(() => {
    let resolve
    const p = new Promise((r) => { resolve = r })
    chamadas.push({ resolve })
    return p
  })
  return { fn, chamadas }
}

const store = (o = {}) => createIdempotencyStore({ file: null, ...o })

describe('coalescência — o envio roda UMA vez por chave', () => {
  it('três requests simultâneas com a mesma chave => 1 envio, 2 duplicatas', async () => {
    const s = store()
    const { fn, chamadas } = envioManual()

    const a = s.run('k', fn)
    const b = s.run('k', fn)
    const c = s.run('k', fn)
    await flush()

    expect(fn).toHaveBeenCalledTimes(1)           // <<< o que importa
    chamadas[0].resolve({ success: true, messageId: 'MSG-1' })

    expect(await a).toEqual({ status: 'sent', messageId: 'MSG-1' })
    expect(await b).toEqual({ status: 'duplicate', messageId: 'MSG-1' })
    expect(await c).toEqual({ status: 'duplicate', messageId: 'MSG-1' })
  })

  it('chaves diferentes não se coalescem', async () => {
    const s = store()
    const { fn, chamadas } = envioManual()
    const a = s.run('k1', fn)
    const b = s.run('k2', fn)
    await flush()
    expect(fn).toHaveBeenCalledTimes(2)
    chamadas.forEach((c, i) => c.resolve({ success: true, messageId: `M${i}` }))
    expect((await a).status).toBe('sent')
    expect((await b).status).toBe('sent')
  })

  it('chave já concluída antes: responde duplicata SEM chamar o envio', async () => {
    const s = store()
    const { fn, chamadas } = envioManual()
    const first = s.run('k', fn)
    await flush()
    chamadas[0].resolve({ success: true, messageId: 'MSG-1' })
    await first

    const depois = await s.run('k', fn)
    expect(depois).toEqual({ status: 'duplicate', messageId: 'MSG-1' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('P1-8 — falha do titular NÃO libera todos os waiters de uma vez', () => {
  it('com 4 esperando e o titular falhando, só UM novo envio acontece', async () => {
    // O BUG: todos saíam do await juntos, cada um instalava a própria reserva
    // sobrescrevendo a dos outros, e o wacli recebia 4 envios enfileirados.
    const s = store()
    const { fn, chamadas } = envioManual()

    const todos = [s.run('k', fn), s.run('k', fn), s.run('k', fn), s.run('k', fn)]
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)

    chamadas[0].resolve({ success: false, error: 'wacli_timeout_or_killed' })
    await flush()

    // Exatamente UMA retentativa — não quatro.
    expect(fn).toHaveBeenCalledTimes(2)

    chamadas[1].resolve({ success: true, messageId: 'MSG-RETRY' })
    const rs = await Promise.all(todos)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(rs.filter(r => r.status === 'sent')).toHaveLength(1)
    expect(rs.filter(r => r.status === 'duplicate')).toHaveLength(2)
    expect(rs.filter(r => r.status === 'failed')).toHaveLength(1) // o titular original
  })

  it('falha libera a chave: uma request POSTERIOR pode tentar de novo', async () => {
    const s = store()
    const { fn, chamadas } = envioManual()
    const a = s.run('k', fn)
    await flush()
    chamadas[0].resolve({ success: false, error: 'wacli_exit_1' })
    expect(await a).toEqual({ status: 'failed', error: 'wacli_exit_1' })

    const b = s.run('k', fn)
    await flush()
    expect(fn).toHaveBeenCalledTimes(2)      // chave foi liberada
    chamadas[1].resolve({ success: true, messageId: 'MSG-2' })
    expect(await b).toEqual({ status: 'sent', messageId: 'MSG-2' })
  })

  it('contenção extrema devolve "contention" em vez de enfileirar envio', async () => {
    const s = store({ maxAcquireAttempts: 1 })
    const { fn, chamadas } = envioManual()
    const a = s.run('k', fn)
    const b = s.run('k', fn)          // gasta sua única tentativa esperando
    await flush()
    chamadas[0].resolve({ success: false, error: 'x' })
    expect((await b).status).toBe('contention')
    expect(fn).toHaveBeenCalledTimes(1)   // NÃO virou um segundo envio
    await a
  })

  it('exceção do envio é sanitizada (nunca vaza texto cru do processo)', async () => {
    const s = store({ sanitizeError: () => 'wacli_failed' })
    const r = await s.run('k', async () => {
      throw new Error('Command failed: wacli send --to 5583999999999 --message SEGREDO')
    })
    expect(r.status).toBe('failed')
    expect(r.error).toBe('wacli_failed')
    expect(JSON.stringify(r)).not.toContain('SEGREDO')
    expect(JSON.stringify(r)).not.toContain('5583999999999')
  })
})

describe('persistência em disco', () => {
  const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'idemp-'))

  it('sobrevive a restart: chave salva volta como duplicata', async () => {
    const dir = tmpdir(); const file = path.join(dir, 'sent-keys.json')
    const s1 = createIdempotencyStore({ file })
    await s1.run('k', async () => ({ success: true, messageId: 'MSG-1' }))

    const s2 = createIdempotencyStore({ file }) // "restart"
    s2.load()
    const fn = vi.fn()
    expect(await s2.run('k', fn)).toEqual({ status: 'duplicate', messageId: 'MSG-1' })
    expect(fn).not.toHaveBeenCalled()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('NÃO persiste chave de envio que falhou (retry legítimo continua possível)', async () => {
    const dir = tmpdir(); const file = path.join(dir, 'sent-keys.json')
    const s1 = createIdempotencyStore({ file })
    await s1.run('ok', async () => ({ success: true, messageId: 'M' }))
    await s1.run('falhou', async () => ({ success: false, error: 'x' }))
    await s1.save()

    const salvo = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(Object.keys(salvo)).toEqual(['ok'])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('arquivo CORROMPIDO não derruba o boot: começa vazio e guarda .corrupt', () => {
    // Este caminho chama o logger. Com a criação do store acima do `const log`
    // no server.js, isso virava ReferenceError e o serviço não subia.
    const dir = tmpdir(); const file = path.join(dir, 'sent-keys.json')
    fs.writeFileSync(file, '{isso não é json')
    let avisou = null
    const s = createIdempotencyStore({ file, log: (m) => { avisou = m } })

    expect(() => s.load()).not.toThrow()
    expect(s.size()).toBe(0)
    expect(avisou).toMatch(/ilegível/)
    expect(fs.existsSync(file + '.corrupt')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('arquivo ausente é normal (primeira execução) — sem aviso', () => {
    const dir = tmpdir()
    let avisou = null
    const s = createIdempotencyStore({ file: path.join(dir, 'nao-existe.json'), log: (m) => { avisou = m } })
    expect(() => s.load()).not.toThrow()
    expect(avisou).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('TTL e poda', () => {
  it('chave vencida deixa de suprimir e o envio roda de novo', async () => {
    let agora = 1_000_000
    const s = store({ ttlMs: 1000, now: () => agora })
    const { fn, chamadas } = envioManual()

    const a = s.run('k', fn)
    await flush()
    chamadas[0].resolve({ success: true, messageId: 'MSG-1' })
    await a
    expect((await s.run('k', fn)).status).toBe('duplicate')

    agora += 5000 // passou do TTL
    const b = s.run('k', fn)
    await flush()
    expect(fn).toHaveBeenCalledTimes(2)
    chamadas[1].resolve({ success: true, messageId: 'MSG-2' })
    expect(await b).toEqual({ status: 'sent', messageId: 'MSG-2' })
  })

  it('poda NÃO remove envio em voo (removeria a trava e duplicaria)', async () => {
    let agora = 1_000_000
    const s = store({ ttlMs: 1, now: () => agora })
    const { fn, chamadas } = envioManual()
    const a = s.run('k', fn)
    await flush()

    agora += 10_000
    s.prune()
    expect(s.size()).toBe(1)              // a reserva em voo sobreviveu

    chamadas[0].resolve({ success: true, messageId: 'MSG-1' })
    await a
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respeita o teto de entradas', async () => {
    const s = store({ maxEntries: 3 })
    for (let i = 0; i < 6; i++) {
      await s.run(`k${i}`, async () => ({ success: true, messageId: `M${i}` }))
    }
    s.prune()
    expect(s.size()).toBeLessThanOrEqual(3)
  })
})
