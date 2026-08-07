/**
 * Webhook da Resend — transforma ACEITE em ENTREGA (auditoria 2026-08, lote 3 · L3-4).
 *
 * A Resend responde `200 { id }` no envio para dizer "aceitei". Quem diz se o e-mail CHEGOU é
 * este endpoint, minutos depois: `email.delivered`, `email.bounced`, `email.complained`.
 *
 * Assinatura: a Resend usa o padrão Svix (`svix-id`, `svix-timestamp`, `svix-signature`).
 * A verificação está escrita à mão com `node:crypto` de propósito — o esquema tem 6 linhas e não
 * justifica uma dependência nova numa superfície exposta à internet.
 *
 * FAIL-CLOSED: sem `RESEND_WEBHOOK_SECRET` o endpoint recusa tudo com 503. Nunca aceitar evento
 * não assinado: quem conseguisse postar aqui marcaria bounces falsos e, pior, marcaria como
 * `delivered` um e-mail que quicou — desligando justamente o alarme.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { applyResendEvent } from '@/lib/email-delivery'
import { logWarn } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Janela de tolerância do carimbo de tempo. Fora dela, o evento é replay. */
const TOLERANCIA_MS = 5 * 60 * 1000

/**
 * Verificação da assinatura Svix.
 *
 * O conteúdo assinado é `${id}.${timestamp}.${corpo}` — o corpo TEM que ser o texto cru recebido,
 * byte a byte. Serializar de novo a partir do objeto (`JSON.stringify(parsed)`) reordena chaves e
 * quebra a assinatura de forma intermitente; por isso a rota lê `await req.text()` antes de tudo.
 */
function assinaturaValida(params: {
  secret: string
  svixId: string
  svixTimestamp: string
  svixSignature: string
  corpoCru: string
  agoraMs: number
}): boolean {
  const ts = Number(params.svixTimestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(params.agoraMs - ts * 1000) > TOLERANCIA_MS) return false

  // O segredo vem como `whsec_<base64>`; o prefixo não faz parte da chave.
  const bruto = params.secret.startsWith('whsec_') ? params.secret.slice(6) : params.secret
  const chave = Buffer.from(bruto, 'base64')
  if (chave.length === 0) return false

  const esperada = createHmac('sha256', chave)
    .update(`${params.svixId}.${params.svixTimestamp}.${params.corpoCru}`)
    .digest('base64')
  const esperadaBuf = Buffer.from(esperada)

  // O header traz uma LISTA separada por espaço (`v1,<sig> v1,<sig>`) — a Svix manda mais de uma
  // durante rotação de segredo. Basta uma bater. Todas são comparadas em tempo constante.
  for (const parte of params.svixSignature.split(' ')) {
    const [versao, sig] = parte.split(',')
    if (versao !== 'v1' || !sig) continue
    const recebida = Buffer.from(sig)
    if (recebida.length === esperadaBuf.length && timingSafeEqual(recebida, esperadaBuf)) return true
  }
  return false
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    logWarn('[resend-webhook] RESEND_WEBHOOK_SECRET não configurado — evento recusado')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const corpoCru = await req.text()
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 })
  }

  if (!assinaturaValida({ secret, svixId, svixTimestamp, svixSignature, corpoCru, agoraMs: Date.now() })) {
    logWarn('[resend-webhook] assinatura inválida', { svixId })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let evento: { type?: string; data?: { email_id?: string; reason?: string; bounce?: { message?: string } } }
  try {
    evento = JSON.parse(corpoCru)
  } catch {
    // Corpo ilegível não melhora com retry — 200 para a Resend parar de reenviar.
    return NextResponse.json({ ok: true, ignored: 'unparseable' })
  }

  const resendId = evento?.data?.email_id
  const type = evento?.type
  if (!type || !resendId) {
    return NextResponse.json({ ok: true, ignored: 'incomplete' })
  }

  const razao = evento.data?.bounce?.message ?? evento.data?.reason ?? null
  const aplicado = await applyResendEvent({ type, resendId, reason: razao })

  // Sempre 200: um erro aqui faria a Resend reenviar o mesmo evento por horas, e a gravação é
  // telemetria — nada do produto depende dela para funcionar.
  return NextResponse.json({ ok: true, applied: aplicado })
}

export const _internals = { assinaturaValida, TOLERANCIA_MS }
