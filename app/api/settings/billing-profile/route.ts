/**
 * POST /api/settings/billing-profile — salva os dados de cobrança do usuário
 * logado e, quando o TELEFONE muda, PROPAGA a troca (camada 1 do desenho
 * 05/08): e-mail de segurança, Asaas na hora, evento à Elen pros DOIS números
 * e WhatsApp ao número ANTIGO (template — destrava quando a Meta aprovar).
 *
 * Nasceu porque o save era client-side direto no Supabase: nenhuma propagação
 * era possível e a troca de telefone acontecia em silêncio.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCustomer } from '@/lib/asaas'
import { sendPhoneChangedEmail } from '@/lib/resend'
import { emitirEventoElen } from '@/lib/elen-eventos'
import { sendConfirmationTemplate, TELEFONE_ALTERADO_TEMPLATE } from '@/lib/whatsapp-confirmations'
import { toWhatsAppDigits } from '@/lib/phone'
import { log, logError, logWarn } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

function mask(phone: string | null | undefined): string {
  const d = toWhatsAppDigits(String(phone ?? '')) ?? String(phone ?? '')
  return d.length >= 4 ? `•••${d.slice(-4)}` : '—'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Rate limit (auditoria 2026-08, lote 2-bis · D9).
  //
  // Cada POST com telefone alterado dispara CINCO efeitos externos: e-mail de segurança pelo
  // Resend, `updateCustomer` no Asaas, dois eventos para a Elen e um template PAGO de WhatsApp
  // para o número antigo. Era a única escrita desse porte sem teto — alternar telefone A→B→A em
  // laço gerava e-mails, mensagens pagas e chamadas ao gateway sem limite, tudo na conta do
  // EidosForm.
  //
  // As irmãs com efeito externo já tinham: `whatsapp/test` 5/15min, `forgot-password` 3/15min,
  // `settings/api-key` 5/min, `domains` 5/min. Adotado o mesmo teto da api-key.
  const rl = await checkRateLimitAsync(`billing-profile:${userId}`, {
    maxAttempts: 5,
    windowMs: 60 * 1000,
  })
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas alterações seguidas. Tente novamente em instantes.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const str = (k: string, max = 120) => {
    const v = body[k]
    return typeof v === 'string' ? v.trim().slice(0, max) || null : null
  }
  const fullName = str('fullName')
  if (!fullName) return NextResponse.json({ error: 'Informe seu nome completo' }, { status: 400 })
  const newPhone = str('phone', 20)

  const admin = createAdminClient()
  const { data: before } = await admin
    .from('profiles')
    .select('phone, email, full_name, asaas_customer_id')
    .eq('id', userId)
    .single<{ phone: string | null; email: string | null; full_name: string | null; asaas_customer_id: string | null }>()

  const oldDigits = toWhatsAppDigits(String(before?.phone ?? '')) ?? null
  const newDigits = toWhatsAppDigits(String(newPhone ?? '')) ?? null
  const phoneChanged = Boolean(oldDigits) && Boolean(newDigits) && oldDigits !== newDigits

  const { error } = await admin
    .from('profiles')
    .update({
      full_name: fullName,
      phone: newPhone,
      cpf_cnpj: str('cpfCnpj', 20),
      address: str('address'),
      address_number: str('addressNumber', 20),
      postal_code: str('postalCode', 12),
      complement: str('complement'),
      province: str('province'),
      city: str('city'),
      state: str('state', 2),
    })
    .eq('id', userId)
  if (error) {
    logError('[billing-profile] update falhou', error, { userId })
    return NextResponse.json({ error: 'Não consegui salvar os dados de cobrança.' }, { status: 500 })
  }

  if (phoneChanged) {
    log('[billing-profile] TELEFONE alterado — propagando (camada 1)', { userId })
    const oldMasked = mask(oldDigits)
    const newMasked = mask(newDigits)
    const propagar = async () => {
      const results = await Promise.allSettled([
        // 1) E-mail de segurança (sai na hora, sem depender de template).
        before?.email
          ? sendPhoneChangedEmail({
              to: before.email,
              name: (before.full_name ?? '').split(/\s+/)[0] || 'tudo bem',
              oldPhoneMasked: oldMasked,
              newPhoneMasked: newMasked,
            })
          : Promise.resolve(null),
        // 2) Asaas NA HORA (antes esperava o próximo checkout).
        before?.asaas_customer_id
          ? updateCustomer(before.asaas_customer_id, { mobilePhone: newDigits ?? undefined })
          : Promise.resolve(null),
        // 3) Evento à Elen pros DOIS números (ficha invalidada + memória).
        emitirEventoElen({ evento: 'telefone', telefone: oldDigits, wamid: `phonechange:${userId}:${newDigits}`, detalhe: `novo número ${newMasked}` }),
        emitirEventoElen({ evento: 'telefone', telefone: newDigits, wamid: `phonechange:${userId}:${newDigits}:novo`, detalhe: `vinculado a esta conta` }),
        // 4) WhatsApp ao número ANTIGO (gated: template PENDING → send_failed e
        //    destrava sozinho na aprovação da Meta — mesmo padrão dos _v2).
        sendConfirmationTemplate({
          toPhone: oldDigits,
          template: TELEFONE_ALTERADO_TEMPLATE,
          bodyParams: [(before?.full_name ?? '').split(/\s+/)[0] || 'tudo bem', newMasked],
          context: `telefone:${userId}`,
        }),
      ])
      for (const r of results) {
        if (r.status === 'rejected') logWarn('[billing-profile] propagação parcial falhou (não bloqueante)', { err: String(r.reason).slice(0, 150) })
      }
    }
    try { after(propagar) } catch { void propagar().catch(() => {}) }
  }

  return NextResponse.json({ success: true, phoneChanged })
}
