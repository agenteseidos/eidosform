/**
 * Cadastro em campanha de trial — POST /api/trial/signup
 *
 * Diferente do cadastro normal (/api/auth/signup) em três pontos:
 *   1. o telefone é OBRIGATÓRIO e é ele que decide a elegibilidade (a lista da campanha);
 *   2. a vaga é RESERVADA antes de a conta existir, para que um cadastro interrompido no meio
 *      possa ser concluído depois pelo reconciliador em vez de sumir;
 *   3. o plano NÃO é concedido aqui — só na confirmação do e-mail, que é a prova de identidade.
 *
 * A resposta é sempre a mesma, elegível ou não: quem não tem direito ao trial ganha uma conta
 * Free normal e um aviso neutro. Nunca dizemos "seu telefone não está na lista" (revelaria a
 * lista) nem "esse e-mail já existe" (enumeração de contas).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { isValidWhatsAppPhone, toWhatsAppDigits } from '@/lib/phone'
import { log, logError } from '@/lib/logger'

const RESPOSTA_PADRAO = {
  success: true,
  message: 'Confira seu e-mail para confirmar a conta.',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const codigo = typeof body?.codigo === 'string' ? body.codigo.trim() : ''
    const email = typeof body?.email === 'string' ? body.email : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
    const phone = typeof body?.phone === 'string' ? body.phone : ''

    if (!codigo || !email || !password || !fullName || !phone) {
      return NextResponse.json({ error: 'Preencha todos os campos.' }, { status: 400 })
    }
    if (!isValidWhatsAppPhone(phone)) {
      return NextResponse.json({ error: 'Telefone inválido. Inclua o DDD.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'A senha precisa de pelo menos 8 caracteres.' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const normalizedPhone = toWhatsAppDigits(phone)
    const emailHash = createHash('sha256').update(normalizedEmail, 'utf8').digest('hex')
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    const [porEmail, porIp, porTelefone, global] = await Promise.all([
      checkRateLimitAsync(`trial:email:${emailHash.slice(0, 24)}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`trial:ip:${ip}`, { maxAttempts: 20, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync(`trial:phone:${normalizedPhone}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
      checkRateLimitAsync('trial:global', { maxAttempts: 300, windowMs: 15 * 60 * 1000 }),
    ])
    const negado = [porEmail, porIp, porTelefone, global].find((r) => !r.allowed)
    if (negado) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente de novo em alguns minutos.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(negado.resetIn / 1000)) } }
      )
    }

    const admin = createAdminClient()

    // A chave de telefone TEM que sair da função do banco: é a mesma regra da coluna gerada
    // `profiles.phone_match_key_br`. O normalizador do TS devolve 13 dígitos (com o nono
    // dígito) e a coluna devolve 12 — usar o do TS faria a lista nunca casar com as contas,
    // em silêncio, e ninguém receberia o trial.
    const { data: phoneKey, error: phoneErr } = await admin.rpc('canonical_phone_match_key_br', {
      raw_phone: normalizedPhone,
    })
    if (phoneErr || !phoneKey) {
      logError('[trial/signup] falha ao canonizar telefone', phoneErr)
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 })
    }

    // Reserva a vaga ANTES de criar a conta. Inelegível não é erro: vira cadastro normal.
    const { data: reservaRaw, error: reservaErr } = await admin.rpc('reserve_trial_signup', {
      p_codigo: codigo,
      p_email_hash: emailHash,
      p_phone_key: phoneKey,
    })
    if (reservaErr) logError('[trial/signup] reserve_trial_signup falhou', reservaErr, { codigo })

    const reserva = (reservaRaw ?? {}) as { ok?: boolean; intent_id?: string; motivo?: string }
    const intentId = reserva.ok ? reserva.intent_id ?? null : null
    if (!reserva.ok) {
      log('[trial/signup] cadastro sem trial', { motivo: reserva.motivo ?? 'erro' })
      await admin.from('trial_claim_attempts').insert({
        motivo: reserva.motivo ?? 'erro_reserva',
        campaign_codigo: codigo,
        phone_tentado: phoneKey,
      })
    }

    const supabase = await createClient()
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: normalizedPhone,
          // Só um LOCALIZADOR do cadastro reservado. Não autoriza nada: a RPC de vínculo
          // confere o usuário real, o hash do e-mail e o telefone antes de aceitar.
          ...(intentId ? { trial_intent: intentId } : {}),
        },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?type=signup`,
      },
    })

    if (signUpErr) {
      const msg = signUpErr.message ?? ''
      const duplicado =
        msg.includes('already registered') ||
        msg.includes('already been registered') ||
        msg.includes('Email not confirmed')
      if (duplicado) return NextResponse.json(RESPOSTA_PADRAO, { status: 201 })
      logError('[trial/signup] signUp falhou', signUpErr)
      return NextResponse.json({ error: 'Não foi possível criar a conta. Tente novamente.' }, { status: 400 })
    }

    const userId = signUpData.user?.id ?? null
    if (intentId && userId) {
      // Grava o user_id no intent ANTES do vínculo: se o passo seguinte falhar, o
      // reconciliador ainda encontra o cadastro por aqui, sem depender do metadata.
      await admin.from('trial_signup_intents').update({ user_id: userId }).eq('id', intentId)

      const { data: bindRaw, error: bindErr } = await admin.rpc('trial_signup_bind', {
        p_intent_id: intentId,
        p_user_id: userId,
      })
      const bind = (bindRaw ?? {}) as { ok?: boolean; motivo?: string }
      if (bindErr || !bind.ok) {
        // Não é erro para o cliente: a conta existe e o reconciliador conclui o vínculo.
        // Um e-mail já cadastrado cai aqui de propósito (o Supabase devolve um usuário
        // ofuscado, sem linha real) — e o silêncio é o que evita revelar que ele existe.
        log('[trial/signup] vínculo não concluído agora', { motivo: bind.motivo ?? 'erro', temErro: Boolean(bindErr) })
      }
    }

    return NextResponse.json(RESPOSTA_PADRAO, { status: 201 })
  } catch (err) {
    logError('[trial/signup] erro inesperado', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
