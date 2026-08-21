import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { logError } from '@/lib/logger'

/**
 * POST /api/internal/contact-inbound — a Elen abastece a FICHA do contato (20/08/2026).
 *
 * Arquitetura decidida pelo Sidney: em vez de a Vercel tentar alcançar a Elen (que escuta em
 * localhost na VPS), a Elen ESCREVE aqui a cada mensagem recebida e a cada opt-out — o mesmo
 * sentido de todas as integrações Elen→EidosForm já existentes (ficha de conta, conversão).
 * O follow-up do hero e a régua de cobrança leem a ficha direto do banco.
 *
 * Corpo: { phone: "5583...", ts: 1755..., optedOut?: true }
 * Auth: Bearer ELEN_OPTOUT_SECRET — o segredo que os dois lados já compartilham.
 *
 * Best-effort dos dois lados: a Elen não espera nem re-tenta em loop (perder um carimbo é
 * infinitamente menos grave que atrasar uma resposta de atendimento), e esta rota é rasa de
 * propósito — upsert e fim.
 */
export async function POST(req: NextRequest) {
  const segredo = process.env.ELEN_OPTOUT_SECRET
  if (!segredo) {
    // Sem segredo configurado a porta nem existe — fail-closed, nunca ingestão anônima.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const ok = token.length === segredo.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(segredo))
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { phone?: unknown; ts?: unknown; optedOut?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }

  const phone = String(body.phone ?? '').replace(/\D/g, '')
  if (!/^\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: 'phone_invalido' }, { status: 400 })
  }
  // O carimbo vem do relógio da Elen; sanidade de ±1 dia barra lixo sem recusar clock skew real.
  const tsNum = Number(body.ts)
  const agora = Date.now()
  const ts = Number.isFinite(tsNum) && Math.abs(agora - tsNum) < 86_400_000 ? tsNum : agora
  const optedOut = body.optedOut === true

  const db = createServiceRoleClient()
  const { error } = await db.from('contact_channel_state').upsert({
    phone,
    last_inbound_at: new Date(ts).toISOString(),
    // Opt-out só LIGA por aqui — nunca desliga por um inbound comum. Quem mandou "PARE" e depois
    // perguntou algo continua fora das automações até decisão humana em contrário.
    ...(optedOut ? { opted_out: true, opted_out_at: new Date(ts).toISOString() } : {}),
    updated_at: new Date().toISOString(),
  } as never, { onConflict: 'phone' })

  if (error) {
    logError('[contact-inbound] falha ao gravar a ficha', error, { phone: phone.slice(0, 4) + '…' })
    return NextResponse.json({ error: 'db' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
