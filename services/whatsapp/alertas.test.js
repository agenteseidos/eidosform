import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { createTransportMetricsStore } from './transport-metrics.js'

function relogio(inicio = Date.parse('2026-08-10T12:00:00Z')) {
  let t = inicio
  return { now: () => t, avanca: (ms) => { t += ms } }
}

function metricas(c) {
  const m = createTransportMetricsStore({ file: null, now: c.now })
  m.load('wuzapi')
  return m
}

describe('alarme de FALHA DE ENVIO — o furo do incidente de 27/07', () => {
  it('não alerta na primeira falha (envio isolado falha por motivo bobo)', async () => {
    const c = relogio(); const m = metricas(c)
    await m.recordFailure({ transport: 'wuzapi', error: 'x' })
    expect(m.shouldAttemptFailureAlert()).toBe(false)
  })

  it('alerta na terceira falha consecutiva', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 3; i++) await m.recordFailure({ transport: 'wuzapi', error: 'fora' })
    expect(m.shouldAttemptFailureAlert()).toBe(true)
  })

  it('UM envio bem-sucedido zera o incidente — o transporte voltou', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 5; i++) await m.recordFailure({ transport: 'wuzapi', error: 'fora' })
    await m.recordSend({ transport: 'wuzapi', fallback: false })
    expect(m.snapshot().failures.consecutive).toBe(0)
    expect(m.shouldAttemptFailureAlert()).toBe(false)
  })

  it('não repete o alerta a cada falha, mas re-alerta se a pane persistir', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 3; i++) await m.recordFailure({ transport: 'wuzapi', error: 'fora' })
    await m.markFailureAlert(true)
    expect(m.shouldAttemptFailureAlert()).toBe(false)

    c.avanca(3 * 3600 * 1000)
    await m.recordFailure({ transport: 'wuzapi', error: 'fora' })
    expect(m.shouldAttemptFailureAlert()).toBe(false) // 3h < 6h

    c.avanca(4 * 3600 * 1000)
    await m.recordFailure({ transport: 'wuzapi', error: 'fora' })
    expect(m.shouldAttemptFailureAlert()).toBe(true) // 7h ⇒ ainda quebrado, avisa de novo
  })

  it('conta as falhas do dia, que é o número que ninguém tinha', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 49; i++) await m.recordFailure({ transport: 'wacli', error: 'wacli_exit_1' })
    expect(m.snapshot().failures.today).toBe(49)
  })
})

describe('alarme de VOLUME — o sinal existia mas ninguém era avisado', () => {
  it('dispara quando o dia é o dobro da média e no máximo 1× por dia', async () => {
    const c = relogio(); const m = metricas(c)
    // 7 dias anteriores com 2 envios/dia ⇒ média 2.
    for (let d = 7; d >= 1; d--) {
      c.avanca(-0) // nada; escrevemos direto no estado por data
    }
    for (let i = 0; i < 20; i++) await m.recordSend({ transport: 'wuzapi', fallback: false })
    expect(m.snapshot().volume.today).toBe(20)
    expect(m.shouldAlertVolume()).toBe(true)

    await m.markVolumeAlert()
    expect(m.shouldAlertVolume()).toBe(false) // já avisou hoje
  })

  it('volume baixo não alarma (menos de 10 envios nunca é sintoma)', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 9; i++) await m.recordSend({ transport: 'wuzapi', fallback: false })
    expect(m.shouldAlertVolume()).toBe(false)
  })

  it('vira o dia e pode alertar de novo', async () => {
    const c = relogio(); const m = metricas(c)
    for (let i = 0; i < 20; i++) await m.recordSend({ transport: 'wuzapi', fallback: false })
    await m.markVolumeAlert()
    expect(m.shouldAlertVolume()).toBe(false)

    c.avanca(24 * 3600 * 1000)
    for (let i = 0; i < 20; i++) await m.recordSend({ transport: 'wuzapi', fallback: false })
    expect(m.shouldAlertVolume()).toBe(true)
  })
})

describe('conteúdo dos alertas', () => {
  it('nenhum alerta carrega telefone ou texto de lead', async () => {
    const { sendSendFailureAlert, sendDeadLetterAlert, sendVolumeAlert } = await import('./ops-alert.js')
    const capturado = []
    const fetchFn = vi.fn(async (_url, opts) => {
      capturado.push(JSON.parse(opts.body))
      return { ok: true }
    })
    // Mesmo defeito que estava em outbox.test.js: caminho ABSOLUTO para o scratchpad de uma
    // sessão de agente antiga, que só existe na VPS de quem escreveu o teste. Em qualquer outro
    // ambiente — incluindo a CI — o diretório não existe e o writeFileSync lança ENOENT.
    // `os.tmpdir()` funciona em qualquer lugar. (auditoria 2026-08)
    const envFile = path.join(os.tmpdir(), `alert-env-${process.pid}-${Date.now()}`)
    const fs = await import('node:fs')
    fs.writeFileSync(envFile, 'RESEND_API_KEY=chave\nADMIN_ALERT_EMAIL=a@b.com\n')

    await sendSendFailureAlert({ consecutive: 3, transport: 'wuzapi', error: 'timeout', queued: 2, fetchFn, envFile })
    await sendDeadLetterAlert({ count: 1, oldest: '2026-08-10T00:00:00Z', fetchFn, envFile })
    await sendVolumeAlert({ today: 50, average7Days: 2, fetchFn, envFile })

    // 3 alertas × 2 destinatários redundantes (o 2º é o gmail de reserva,
    // porque em 24/07 o Resend suprimiu o e-mail principal por 17h).
    expect(capturado).toHaveLength(6)
    expect(new Set(capturado.map((e) => e.to[0])).size).toBe(2)
    for (const email of capturado) {
      const texto = `${email.subject}\n${email.text}`
      expect(texto).not.toMatch(/\b55\d{10,11}\b/)      // nenhum telefone
      expect(texto).not.toMatch(/@gmail|@hotmail/)       // nenhum e-mail de lead
      expect(email.text).toContain('eidosform.com.br/admin/whatsapp')
    }
  })

  it('sem chave do Resend não finge que enviou', async () => {
    const { sendOpsAlert } = await import('./ops-alert.js')
    const enviado = await sendOpsAlert({
      subject: 'x', lines: ['y'], envFile: '/caminho/que/nao/existe',
    })
    expect(enviado).toBe(false)
  })
})
