import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isValidBearerSecret } from '@/lib/bearer-auth'
import { log, logError, logWarn } from '@/lib/logger'
import { buildNotificationModel } from '@/lib/notification-model'
import { resolveEmailRecipients, sendNewResponseEmails } from '@/lib/notification-email'
import { notifyBillingOpsWhatsApp } from '@/lib/billing-ops-whatsapp'
import {
  lerPendentes, marcarEnviado, marcarTentativaFalha, descartarSemAlvo, type ItemFila,
} from '@/lib/email-retry-queue'

/**
 * GET /api/cron/email-retry — dreno da fila de reenvio de e-mail (D-05).
 *
 * A fila guarda REFERÊNCIA, nunca conteúdo (ver `lib/email-retry-queue.ts`). Este dreno é quem
 * paga o preço dessa decisão: remonta o e-mail a partir do banco a cada tentativa. É mais
 * trabalho por item, e vale cada linha — nenhum dado do lead fica duplicado esperando reenvio, e
 * resposta apagada some do reenvio sem rotina de expurgo.
 *
 * ⚠️ O QUE ESTE DRENO NÃO FAZ: reenviar o que a Resange ACEITOU e depois quicou. Aceite ≠ entrega
 * é o outro lado da moeda e vive em `email_deliveries` + webhook da Resend (L3-4). Aqui só entra
 * o que nunca chegou a ser aceito — falha de transporte.
 */
export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/email-retry] service-role ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const pendentes = await lerPendentes(50)
  const r = { total: pendentes.length, enviados: 0, reagendados: 0, mortos: 0, descartados: 0 }

  for (const item of pendentes) {
    try {
      const desfecho = await tentarReenvio(db as unknown as LeitorTabelas, item)
      if (desfecho === 'enviado') r.enviados++
      else if (desfecho === 'descartado') r.descartados++
      else if (desfecho === 'morto') r.mortos++
      else r.reagendados++
    } catch (err) {
      // Exceção inesperada não pode matar o dreno inteiro — o próximo item ainda tem chance.
      const msg = err instanceof Error ? err.message : String(err)
      const desfecho = await marcarTentativaFalha(item, msg)
      if (desfecho === 'morto') { r.mortos++; await avisarMorte(item, msg) } else r.reagendados++
    }
  }

  if (r.total > 0) log('[cron/email-retry] concluído', r)
  return NextResponse.json({ ok: true, ...r })
}

type Desfecho = 'enviado' | 'reagendado' | 'morto' | 'descartado'

/** Só o que este dreno usa do client — evita a briga de genéricos do supabase-js tipado. */
type LeitorTabelas = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> }
    }
  }
}

async function tentarReenvio(db: LeitorTabelas, item: ItemFila): Promise<Desfecho> {
  // 1) A resposta ainda existe? Apagada = exclusão respeitada, não falha.
  const { data: resposta } = await db
    .from('responses')
    .select('id, answers, submitted_at, meta_events, url_params, utm')
    .eq('id', item.response_id)
    .maybeSingle()
  if (!resposta) {
    await descartarSemAlvo(item.id, 'resposta não existe mais')
    return 'descartado'
  }

  // 2) O formulário e o dono — daqui saem os destinatários ATUAIS (não os de quando falhou).
  const { data: form } = await db
    .from('forms')
    .select('id, title, user_id, questions, notify_email, notify_email_enabled, notify_owner_enabled')
    .eq('id', item.form_id)
    .maybeSingle()
  if (!form) {
    await descartarSemAlvo(item.id, 'formulário não existe mais')
    return 'descartado'
  }
  const { data: dono } = await db
    .from('profiles')
    .select('email')
    .eq('id', (form as { user_id: string }).user_id)
    .maybeSingle()

  const f = form as {
    id: string; title: string; user_id: string
    questions?: Array<{ id: string; title?: string; type?: string }>
    notify_email?: string | null; notify_email_enabled?: boolean | null; notify_owner_enabled?: boolean | null
  }
  const destinatarios = resolveEmailRecipients({
    ownerEmail: (dono as { email?: string } | null)?.email ?? null,
    notifyEmail: f.notify_email,
    notifyEmailEnabled: f.notify_email_enabled,
    notifyOwnerEnabled: f.notify_owner_enabled,
  })
  // Só o PAPEL que falhou. Se o dono desligou aquele destinatário depois do erro, o papel some
  // daqui e o item é descartado — respeitar a configuração de HOJE é o comportamento certo.
  const alvo = destinatarios.filter((d) => d.role === item.role)
  if (alvo.length === 0) {
    await descartarSemAlvo(item.id, `papel ${item.role} não é mais destinatário`)
    return 'descartado'
  }

  const resp = resposta as {
    answers?: Record<string, unknown>; submitted_at?: string
    meta_events?: unknown; url_params?: unknown; utm?: unknown
  }
  const model = buildNotificationModel({
    formId: f.id,
    responseId: item.response_id,
    responseData: (resp.answers ?? {}) as Record<string, unknown>,
    form: { id: f.id, title: f.title, user_id: f.user_id, questions: f.questions ?? [] },
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br',
    eventAt: resp.submitted_at ?? new Date().toISOString(),
    metaEvents: resp.meta_events as never,
    urlParams: resp.url_params as never,
    utm: resp.utm as never,
  })

  const [saida] = await sendNewResponseEmails({ model, recipients: alvo })
  if (saida && !saida.error) {
    await marcarEnviado(item.id)
    log('[cron/email-retry] reenvio entregue à Resend', {
      formId: item.form_id, responseId: item.response_id, role: item.role, tentativa: item.attempts + 1,
    })
    return 'enviado'
  }

  const erro = saida?.error ?? 'sem resultado do envio'
  const desfecho = await marcarTentativaFalha(item, erro)
  if (desfecho === 'morto') {
    await avisarMorte(item, erro)
    return 'morto'
  }
  return 'reagendado'
}

/**
 * Fim da janela de 48h. O aviso vai pelo WhatsApp de propósito: é justamente o canal que funciona
 * quando o e-mail não funciona. E leva só REFERÊNCIA — nada do lead na mensagem.
 */
async function avisarMorte(item: ItemFila, erro: string): Promise<void> {
  logWarn('[cron/email-retry] item MORTO após a janela de 48h', {
    formId: item.form_id, responseId: item.response_id, role: item.role, erro,
  })
  await notifyBillingOpsWhatsApp(
    `📪 EidosForm: aviso de lead NÃO entregue por e-mail\n` +
    `Formulário ${item.form_id}\nResposta ${item.response_id}\n` +
    `Destinatário: ${item.role}\nÚltimo erro: ${erro.slice(0, 120)}\n` +
    `O lead está salvo no painel — só o e-mail falhou.`,
    `email-dead:${item.response_id}:${item.role}`,
  ).catch(() => {})
}
