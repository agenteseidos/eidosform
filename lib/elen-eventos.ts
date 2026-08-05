/**
 * lib/elen-eventos.ts — Pacote B (mesa Claude×Codex 2026-08-03, PLANO FECHADO v1).
 *
 * No ATO de enviar uma confirmação transacional por WhatsApp, o EidosForm avisa
 * o bot da Elen (POST /interno/evento-conta na VPS). Efeitos lá: ficha cacheada
 * invalidada na hora (nem a janela de 12min sobra pra quem mudou de plano) +
 * memória do evento ("recebi" solto ganha contexto) + índice por WAMID.
 *
 * Regras do parecer Codex (incorporadas):
 *  - eventId DETERMINÍSTICO: HMAC(secret, "event-id:v1\n<evento>\n<wamid>") —
 *    o WAMID é único por mensagem ENVIADA, então retry deste emit re-gera o
 *    MESMO id e o receptor deduplica (7d). Nenhum ID interno viaja cru.
 *  - Assinatura: HMAC(secret, `${ts}\n${eventId}\n${corpo}`) + antirreplay 5min.
 *  - Retry curto: 3 tentativas (0s/1s/5s), timeout 2s; desiste em 4xx exceto
 *    408/429. Falha total = log; a Elen degrada pro Pacote A (consulta fresca
 *    quando perguntam de plano) — nunca pior que antes.
 *  - Corpo mínimo (sem proxCobranca, sem e-mail, sem IDs de sub).
 *  - SEMPRE chamado de dentro do fluxo pós-resposta do chamador (after()/
 *    background) — nunca atrasa nem quebra a ação principal.
 */
import { createHmac } from 'crypto'
import { toWhatsAppDigits } from '@/lib/phone'
import { log, logWarn } from '@/lib/logger'

export type ElenEventoTipo = 'cadastro' | 'ativado' | 'alterado' | 'cancelado' | 'acesso' | 'telefone'

/** Mesmo normalizador do ENVIO (55+DDD+número) — a chave do contato no bot nasce do waId. */
function digits(v: string | null | undefined): string | null {
  const d = toWhatsAppDigits(String(v ?? ''))
  return d && d.length >= 10 && d.length <= 15 ? d : null
}

export async function emitirEventoElen(params: {
  evento: ElenEventoTipo
  telefone: string | null | undefined
  wamid: string
  detalhe?: string | null
}): Promise<{ sent: boolean; skipped?: string }> {
  const url = process.env.ELEN_EVENTO_URL
  const secret = process.env.ELEN_EVENTO_SECRET
  if (!url || !secret) return { sent: false, skipped: 'no_config' }
  const tel = digits(params.telefone)
  if (!tel || !params.wamid) return { sent: false, skipped: 'no_phone_or_wamid' }

  const eventId = createHmac('sha256', secret)
    .update(`event-id:v1\n${params.evento}\n${params.wamid}`)
    .digest('hex')
  const body = JSON.stringify({
    v: 1,
    evento: params.evento,
    telefone: tel,
    ...(params.detalhe ? { detalhe: String(params.detalhe).slice(0, 80) } : {}),
    wamid: params.wamid,
  })

  for (const espera of [0, 1000, 5000]) {
    if (espera) await new Promise((r) => setTimeout(r, espera))
    const ts = Date.now()
    const sig = createHmac('sha256', secret).update(`${ts}\n${eventId}\n${body}`).digest('hex')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-elen-timestamp': String(ts),
          'x-elen-event-id': eventId,
          'x-elen-signature': sig,
        },
        body,
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) {
        log('[elen-evento] Evento entregue', { evento: params.evento })
        return { sent: true }
      }
      // 4xx (fora 408/429) = definitivo — repetir não muda nada.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        logWarn('[elen-evento] Rejeitado pelo receptor — desistindo', { evento: params.evento, status: res.status })
        return { sent: false, skipped: `http_${res.status}` }
      }
      logWarn('[elen-evento] Falha transitória — retry', { evento: params.evento, status: res.status })
    } catch (err) {
      logWarn('[elen-evento] Rede/timeout — retry', { evento: params.evento, err: String(err).slice(0, 120) })
    }
  }
  logWarn('[elen-evento] Evento NÃO entregue após retries (Elen degrada pro Pacote A)', { evento: params.evento })
  return { sent: false, skipped: 'retries_exhausted' }
}
