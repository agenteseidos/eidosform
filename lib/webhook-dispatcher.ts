/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * SSRF protection — blocks private IPs and non-HTTPS URLs.
 */

import { validateWebhookUrlAsync } from './webhook-validator'
import { criarDispatcherComPino } from './webhook-fetch-pinned'
import { logError, logWarn } from '@/lib/logger'
import { createClient } from '@supabase/supabase-js'
import { sendWebhookFailureAlert } from '@/lib/resend'
import type { ExtractedLead } from '@/lib/lead-extraction'

export interface WebhookFieldMeta {
  question_id: string
  type: string
  title: string
}

export interface WebhookPayload {
  event: 'form.response'
  form_id: string
  response_id: string
  created_at: string
  lead?: ExtractedLead
  data: Record<string, unknown>
  fields?: WebhookFieldMeta[]
  /** Campos ocultos capturados da URL do form (hidden fields), já sanitizados */
  url_params?: Record<string, string>
  /**
   * UTMs capturadas na chegada do lead (janela last-touch de 30 dias) — só
   * chaves com valor. Fecha o furo de atribuição "lead chega no CRM sem
   * origem" (auditoria LP 2026-07-28): a UTM já saía no CSV/Sheets mas não
   * no webhook. Campo ADITIVO — consumidores existentes não quebram.
   */
  utm?: Record<string, string>
}

/**
 * Sort object keys recursively for deterministic JSON serialization.
 * Required so HMAC is identical across retry attempts.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)])
    )
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Consumers verify: crypto.createHmac('sha256', secret).update(payload).digest('hex')
 */
async function generateWebhookSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function insertDlq(params: {
  formId: string
  responseId: string
  webhookUrl: string
  error: string
  ownerEmail?: string
}): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase.from('webhook_failures').insert({
      form_id: params.formId,
      response_id: params.responseId,
      webhook_url: params.webhookUrl,
      last_error: params.error,
      owner_email: params.ownerEmail ?? null,
    })

    if (params.ownerEmail) {
      await maybeNotifyOwnerOfWebhookFailures({
        formId: params.formId,
        ownerEmail: params.ownerEmail,
      })
    }
  } catch (err) {
    // A gravação na fila morta NUNCA pode derrubar o fluxo da resposta — isso continua valendo.
    // Mas engolir em silêncio apagava a ÚLTIMA evidência de que houve falha: com o banco
    // instável, o webhook falhava, a DLQ não gravava e não sobrava rastro em lugar nenhum.
    // Agora o log fica. (auditoria 2026-08, lote 3 · L3-2)
    logError('[webhook-dispatcher] falha ao gravar na fila morta — evidência só neste log', err, {
      formId: params.formId,
      responseId: params.responseId,
    })
  }
}

/**
 * Notify the form owner once per 24h when ≥3 webhook failures happened in the
 * past 7 days. Reads webhook_failures + writes webhook_failure_notifications.
 *
 * EXPORTADA só para teste (lote 3 · L3-1). A trava anti-rajada aqui dentro é a parte arriscada do
 * lote — se ela falhar, o cliente recebe uma enxurrada de e-mails. Testá-la através de
 * `dispatchWebhook` obrigaria a atravessar 4 tentativas de rede com backoff, e o arranjo de
 * temporizadores falsos necessário para isso se mostrou INTERMITENTE (o disparo espera
 * `crypto.subtle.sign` e `fetch`, que não são temporizadores). Teste que passa às vezes é pior
 * que teste nenhum: ensina a ignorar o vermelho.
 *
 * ⚠️ `notify_owner_enabled` NÃO é consultado aqui — e isso é DELIBERADO, não esquecimento.
 *
 * Aquele campo governa CONTEÚDO: "quero receber um e-mail a cada lead?". Este aviso é de SERVIÇO:
 * "sua integração parou de funcionar". São coisas diferentes, e confundi-las produz o pior
 * desfecho possível. Pergunte por que alguém desligaria a notificação por lead: a razão mais
 * provável é "porque liguei o webhook para o meu CRM e não preciso mais do e-mail". Ou seja, quem
 * desliga é justamente quem passa a depender SÓ do webhook — e respeitar o toggle deixaria essa
 * pessoa sem lead e sem aviso ao mesmo tempo, cega dos dois lados.
 *
 * O envio já é limitado a 1 por formulário a cada 24h pela trava logo abaixo, então não há risco
 * de virar incômodo.
 *
 * Se um dia a decisão mudar, o lugar é aqui: basta ler `notify_owner_enabled` do formulário e
 * sair cedo. Mas mude o comentário junto — o silêncio é que faz isso parecer bug.
 */
export async function maybeNotifyOwnerOfWebhookFailures(params: {
  formId: string
  ownerEmail: string
}): Promise<void> {
  try {
    const supabase = getSupabase()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: failures, error: failuresError } = await supabase
      .from('webhook_failures')
      .select('webhook_url, last_error, created_at')
      .eq('form_id', params.formId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10)
    if (failuresError || !failures || failures.length < 3) return

    // CLAIM ANTES DE ENVIAR — trava anti-rajada (auditoria 2026-08, lote 3 · L3-1).
    //
    // A forma antiga era LER `last_notified_at`, decidir, ENVIAR e só então gravar. Entre a
    // leitura e a gravação cabia tudo: submissões concorrentes do mesmo formulário rodam em
    // paralelo dentro do `after()`, todas liam "sem notificação recente", todas passavam no
    // gate e todas enviavam. O cliente receberia uma RAJADA de e-mails de alerta em vez de um.
    //
    // Agora a vaga é RESERVADA antes do envio, e a reserva é atômica no banco:
    //  1. UPDATE condicional — só vence quem encontrar a linha com a marca velha (>24h).
    //  2. Se nenhuma linha foi atualizada, tenta INSERT — cobre a primeira notificação daquele
    //     formulário. Conflito de chave (23505) significa que outra execução chegou primeiro.
    // Em ambos os caminhos, perder a disputa é `return` silencioso: alguém já está enviando.
    //
    // Update-then-insert, e não `upsert`: o upsert sobrescreveria a marca de quem venceu,
    // reabrindo a janela em vez de fechá-la.
    const agora = new Date().toISOString()
    const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: claimed } = await supabase
      .from('webhook_failure_notifications')
      .update({ last_notified_at: agora, failure_count_window: failures.length })
      .eq('form_id', params.formId)
      .lt('last_notified_at', limite24h)
      .select('form_id')

    if (!claimed || claimed.length === 0) {
      // Não venceu o UPDATE: ou a linha não existe (1ª vez), ou já foi notificado nas últimas
      // 24h. O INSERT distingue os dois — conflito = já notificado.
      const { error: insertErr } = await supabase
        .from('webhook_failure_notifications')
        .insert({
          form_id: params.formId,
          last_notified_at: agora,
          failure_count_window: failures.length,
        })
      if (insertErr) return // linha já existia e está dentro da janela → outra execução cuida
    }

    const { data: form } = await supabase
      .from('forms')
      .select('title')
      .eq('id', params.formId)
      .maybeSingle()

    await sendWebhookFailureAlert({
      to: params.ownerEmail,
      formTitle: form?.title ?? 'Formulário',
      formId: params.formId,
      failures: failures.slice(0, 3).map((f) => ({
        webhook_url: String(f.webhook_url ?? ''),
        last_error: String(f.last_error ?? ''),
        created_at: String(f.created_at ?? ''),
      })),
    })

    // A marca já foi gravada no claim acima — regravar aqui reabriria a janela de rajada.
  } catch (err) {
    logWarn('[webhook-dispatcher] Owner notification failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Dispara POST para webhook_url configurada pelo usuário.
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * Falhas são logadas mas não bloqueiam o fluxo.
 *
 * WEBHOOK_SECRET is mandatory. Dispatch is aborted without it (P0-INT1).
 */
export async function dispatchWebhook(params: {
  webhookUrl: string
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  fields?: WebhookFieldMeta[]
  /** Canonical lead fields (name/email/phone) extracted from response */
  lead?: ExtractedLead
  /** Campos ocultos capturados da URL (hidden fields), já sanitizados */
  urlParams?: Record<string, string> | null
  /** UTMs gravadas com a resposta (utm_source/medium/campaign/term/content) */
  utm?: Record<string, string | null> | null
  /** Owner email for DLQ notification after all retries fail */
  ownerEmail?: string
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const { webhookUrl, formId, responseId, responseData, fields, lead, urlParams, utm, ownerEmail } = params

  // WEBHOOK_SECRET is mandatory — abort without it (P0-INT1)
  const webhookSecret = process.env.WEBHOOK_SECRET
  if (!webhookSecret) {
    logWarn('[webhook-dispatcher] WEBHOOK_SECRET not configured — dispatch aborted', { formId })
    return { success: false, error: 'WEBHOOK_SECRET not configured' }
  }

  // SSRF validation (async — includes DNS rebinding check)
  const urlCheck = await validateWebhookUrlAsync(webhookUrl)
  if (!urlCheck.safe) {
    logError('[webhook-dispatcher] BLOCKED', { formId, reason: urlCheck.reason })
    // Rejeição por SSRF também vai para a fila morta (auditoria 2026-08, lote 3 · L3-3c).
    // Antes esse caminho retornava ANTES do `insertDlq`: o lead não chegava ao CRM do cliente e
    // NÃO ficava registro nenhum no banco — só uma linha de log na Vercel. Com o aperto de
    // `every`→`some` deste mesmo commit, mais URLs passam a cair aqui, então o rastro deixa de
    // ser opcional: é como o dono vai descobrir que o endpoint dele foi recusado.
    await insertDlq({
      formId,
      responseId,
      webhookUrl,
      error: `BLOCKED: ${urlCheck.reason ?? 'url recusada'}`,
      ownerEmail,
    })
    return { success: false, error: urlCheck.reason }
  }

  const payload: WebhookPayload = {
    event: 'form.response',
    form_id: formId,
    response_id: responseId,
    created_at: new Date().toISOString(),
    ...(lead ? { lead } : {}),
    data: responseData,
    ...(fields && fields.length > 0 ? { fields } : {}),
    ...(urlParams && Object.keys(urlParams).length > 0 ? { url_params: urlParams } : {}),
    ...(() => {
      const entries = Object.entries(utm ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0
      )
      return entries.length > 0 ? { utm: Object.fromEntries(entries) } : {}
    })(),
  }

  // Canonical JSON: sort keys so HMAC is deterministic across retries (P1-INT2)
  const bodyStr = canonicalJson(payload)

  // Generate signature once, outside the retry loop (timestamp fixed across retries)
  const signature = await generateWebhookSignature(bodyStr, webhookSecret)
  const fixedTimestamp = new Date().toISOString()

  const MAX_RETRIES = 3
  const retryDelays = [1000, 2000, 4000]
  let lastError: string | undefined

  // ORÇAMENTO TOTAL (auditoria 2026-08, lote 3 · L3-2).
  //
  // O pior caso antes disto: 4 tentativas de até 10s + 7s de espera = ~47s. Este disparo roda em
  // `after()`, depois de a resposta já ter ido para o lead; se a função serverless for encerrada
  // antes do fim, o `insertDlq` do final NUNCA roda. Ou seja: justamente quando o webhook do
  // cliente estava mais lento — o cenário que mais importa — a falha não era registrada e o aviso
  // ao dono não saía. A falha ficava invisível por ser demorada demais.
  //
  // O teto abaixo só INTERROMPE tentativas; nunca acrescenta uma. Reduz o número de POSTs no pior
  // caso e garante que sobre tempo para gravar a fila morta. Por isso não há risco de duplicata:
  // deliberadamente NÃO mexemos no timeout de 10s por tentativa nem transformamos o disparo da v1
  // em `after()` — as duas coisas multiplicariam POSTs num destino sem chave de idempotência.
  const ORCAMENTO_MS = 25_000
  const inicio = Date.now()
  // Um por disparo (barato) e não por tentativa — as 4 tentativas usam a mesma regra de conexão.
  const dispatcherComPino = criarDispatcherComPino()

  // Custo máximo de uma tentativa: o timeout do POST. Usado na PREVISÃO abaixo.
  const CUSTO_TENTATIVA_MS = 10_000

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // PREVISÃO, não retrovisor (L3-2b, fechado na varredura de 11/08/2026). A checagem antiga
      // era `agora - inicio >= orçamento`: olhava só o tempo JÁ gasto. Aos 21s ela passava
      // (21 < 25), dormia 2s e disparava um POST de até 10s — terminando aos 33s, além do
      // orçamento que existe precisamente para sobrar tempo de gravar a fila morta antes de a
      // função serverless ser encerrada. O teto virava decoração no pior caso, que é o único
      // caso em que ele importa.
      //
      // Agora a pergunta é "a PRÓXIMA tentativa consegue TERMINAR dentro do orçamento?" —
      // espera + POST inteiro. Se não cabe, para agora, com folga garantida para o insertDlq.
      const custoProximaTentativa = retryDelays[attempt - 1] + CUSTO_TENTATIVA_MS
      if (Date.now() - inicio + custoProximaTentativa >= ORCAMENTO_MS) {
        lastError = `${lastError ?? 'unknown'} (orçamento de ${ORCAMENTO_MS}ms não comporta a tentativa ${attempt + 1} — parando com folga p/ DLQ)`
        break
      }
      await new Promise(r => setTimeout(r, retryDelays[attempt - 1]))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      const res = await fetch(webhookUrl, {
        // Pino de IP (E08-S1-008): a validação prévia resolve o DNS, mas o fetch resolve de
        // novo — e entre as duas cabe um rebinding para a rede interna. O dispatcher confere o
        // endereço no INSTANTE da conexão. `undefined` no runtime sem undici mantém o
        // comportamento anterior; webhook é recurso pago e não pode cair por endurecimento.
        ...(dispatcherComPino ? { dispatcher: dispatcherComPino } : {}),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EidosForm-Event': 'form.response',
          'X-EidosForm-Form-Id': formId,
          'X-EidosForm-Signature': `sha256=${signature}`,
          'X-EidosForm-Timestamp': fixedTimestamp,
          // Estável entre as 4 tentativas: permite ao CRM do cliente descartar a repetição de um
          // envio que ele já processou (lote 3 · L3-2). Sem este cabeçalho, um webhook que recebe
          // e responde devagar processa o mesmo lead até 4 vezes — e era o que impedia qualquer
          // aumento de tentativas. Receptor que ignora o cabeçalho não é afetado em nada.
          'X-EidosForm-Delivery-Id': responseId,
        },
        body: bodyStr,
        signal: controller.signal,
        redirect: 'manual',
      })
      clearTimeout(timeout)

      if (res.ok) return { success: true, statusCode: res.status }

      lastError = `HTTP ${res.status}`
    } catch (err) {
      clearTimeout(timeout)
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  logError('[webhook-dispatcher] FAILED — todas as tentativas esgotadas', { formId, responseId, error: lastError })

  // DLQ: persist failure for dead-letter queue processing
  await insertDlq({ formId, responseId, webhookUrl, error: lastError ?? 'unknown', ownerEmail })

  return { success: false, error: lastError }
}
