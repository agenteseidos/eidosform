import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createWacliTransport } from './transport-wacli.js'
import { createOutbox, DEFAULT_MAX_ATTEMPTS } from './outbox.js'
import { ERROR_CLASS } from './transport.js'

/**
 * O wacli de verdade é substituído por um executável de mentira que só imprime o
 * que a variável de ambiente mandar. É proposital não usar mock de módulo: assim
 * o teste exercita o caminho REAL (execFile + parsing do stdout), que é onde o
 * defeito das 25 cópias morava.
 */
let baseDir
let fakeWacli

beforeAll(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wacli-test-'))
  fakeWacli = path.join(baseDir, 'wacli-falso.js')
  fs.writeFileSync(
    fakeWacli,
    [
      '#!/usr/bin/env node',
      'process.stdout.write(process.env.FAKE_WACLI_STDOUT || "");',
      'if (process.env.FAKE_WACLI_STDERR) process.stderr.write(process.env.FAKE_WACLI_STDERR);',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
})

afterAll(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

const transportes = []

afterEach(async () => {
  delete process.env.FAKE_WACLI_STDOUT
  delete process.env.FAKE_WACLI_STDERR
  while (transportes.length) await transportes.pop().shutdown()
})

function comResposta(json) {
  process.env.FAKE_WACLI_STDOUT = `${json}\n`
  const transport = createWacliTransport({
    log: () => {},
    hashPhone: () => 'hash',
    baseDir,
    wacliPath: fakeWacli,
  })
  transportes.push(transport)
  return transport
}

describe('transporte wacli — envio aceito sem identificador de mensagem', () => {
  it('ACEITO sem `id` é SUCESSO, não falha reenviável (as 25 cópias)', async () => {
    // Shape real possível: o campo `id` é `omitempty` no wacli — some do JSON
    // quando vem vazio. O envio foi aceito do mesmo jeito.
    const transport = comResposta(JSON.stringify({ success: true, data: { to: '5583999999999', sent: true } }))

    const r = await transport.enviarTexto('5583999999999', 'Novo lead no formulário')

    expect(r.success).toBe(true)
    expect(r.errorClass).toBeNull()
    // Precisa devolver ALGUM id: `idemp.remember` (usado na reentrega da fila)
    // ignora id vazio, e sem ele o cron de abandonado repediria a notificação.
    expect(r.messageId).toBeTruthy()
    expect(r.messageId).toMatch(/^wacli-sem-id-/)
  })

  it('ACEITO por `messages_stored` sem `id` também é SUCESSO', async () => {
    const transport = comResposta(JSON.stringify({ success: true, data: { messages_stored: 1 } }))

    const r = await transport.enviarTexto('5583999999999', 'Novo lead no formulário')

    expect(r.success).toBe(true)
    expect(r.errorClass).toBeNull()
    expect(r.messageId).toBeTruthy()
  })

  it('não devolve IN_FLIGHT — era o que fazia a fila reenviar', async () => {
    const transport = comResposta(JSON.stringify({ success: true, data: {} }))

    const r = await transport.enviarTexto('5583999999999', 'Novo lead no formulário')

    expect(r.errorClass).not.toBe(ERROR_CLASS.IN_FLIGHT)
    expect(r.error ?? null).toBeNull()
  })

  it('o dono do formulário recebe UMA notificação, não 25', async () => {
    // Reproduz o ciclo real: 1ª tentativa + fila de reenvio (server.js
    // handleFailedSend -> outbox.enqueue -> drainOutbox -> outbox.settle).
    // Cada chamada ao wacli é uma ENTREGA: ele aceitou a mensagem.
    const transport = comResposta(JSON.stringify({ success: true, data: { to: '5583999999999', sent: true } }))

    let agora = 1_000_000
    const outbox = createOutbox({ now: () => agora })
    const chave = 'form:abc:response:def'
    const destino = '5583999999999'
    const texto = 'Novo lead no formulário'

    let entregas = 0
    const enviar = async () => {
      entregas += 1
      return transport.enviarTexto(destino, texto)
    }

    const primeira = await enviar()
    if (!primeira.success) {
      await outbox.enqueue({ key: chave, to: destino, message: texto, error: primeira.error })
      // Roda mais rodadas do que a fila aguenta, para provar que ela desiste
      // sozinha e não que o laço do teste é que segurou o número.
      for (let rodada = 0; rodada < DEFAULT_MAX_ATTEMPTS + 5; rodada++) {
        agora += 3_600_000 // pula o backoff
        const pendentes = outbox.due()
        if (pendentes.length === 0) break
        const r = await enviar()
        const veredito = await outbox.settle(chave, { success: r.success, error: r.error })
        if (veredito !== 'retry') break
      }
    }

    expect(entregas).toBe(1)
    expect(outbox.snapshot().pending).toBe(0)
    expect(outbox.snapshot().dead).toBe(0)
  }, 30_000)
})

describe('transporte wacli — o que NÃO pode mudar', () => {
  it('resposta com `id` continua devolvendo o id real do WhatsApp', async () => {
    const transport = comResposta(JSON.stringify({ success: true, data: { id: '0ACFDB7CC4C2073D106F8F687CBF7861' } }))

    const r = await transport.enviarTexto('5583999999999', 'oi')

    expect(r).toEqual(expect.objectContaining({ success: true, messageId: '0ACFDB7CC4C2073D106F8F687CBF7861' }))
  })

  it('`messages_stored: 0` continua sendo FALHA (o falso positivo do wacli)', async () => {
    const transport = comResposta(JSON.stringify({ success: true, data: { messages_stored: 0, id: 'X' } }))

    const r = await transport.enviarTexto('5583999999999', 'oi')

    expect(r.success).toBe(false)
    expect(r.errorClass).toBe(ERROR_CLASS.IN_FLIGHT)
  })

  it('`success: false` continua sendo falha classificada', async () => {
    const transport = comResposta(JSON.stringify({ success: false, error: 'not authenticated' }))

    const r = await transport.enviarTexto('5583999999999', 'oi')

    expect(r.success).toBe(false)
    expect(r.errorClass).toBe(ERROR_CLASS.PRE_FLIGHT)
  })

  it('saída sem JSON nenhum continua sendo wacli_no_json', async () => {
    const transport = comResposta('nada de json aqui')

    const r = await transport.enviarTexto('5583999999999', 'oi')

    expect(r).toEqual(expect.objectContaining({ success: false, error: 'wacli_no_json' }))
  })
})
