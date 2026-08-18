/**
 * lib/meta-capi.ts — envio de evento ao Meta pelo SERVIDOR (Conversions API).
 *
 * ⚠️ MUDANÇA DE 18/08/2026 — LEIA ANTES DE MEXER.
 *
 * Até esta data, este arquivo lia `META_PIXEL_ID` e `META_ACCESS_TOKEN` do ambiente: UM pixel e
 * UM token GLOBAIS, os da plataforma. O cliente colava o pixel DELE no construtor, e o servidor
 * mandava o evento para a conta do Instituto Eidos. Duas consequências, ambas ruins: a conversão
 * do cliente nunca chegava por este caminho, e o e-mail/telefone do lead DELE — hasheados, mas
 * hasheados justamente para o Meta reconhecer a pessoa — entravam no NOSSO ativo de publicidade.
 *
 * AGORA o pixel e o token vêm POR FORMULÁRIO, como PARÂMETRO. Não há mais leitura de ambiente e
 * NÃO HÁ FALLBACK GLOBAL: formulário sem credencial simplesmente não tem envio pelo servidor — o
 * pixel do navegador continua funcionando normalmente, como sempre funcionou. Um fallback aqui
 * recriaria o problema inteiro no primeiro formulário mal configurado.
 *
 * O Pixel ID sozinho não basta: ele é PÚBLICO (está no fonte de qualquer página que anuncia). Por
 * isso o Meta exige token para aceitar evento por esta via — senão qualquer um injetaria conversão
 * falsa na conta de qualquer concorrente. O token do cliente mora cifrado em
 * `form_capi_credentials` (ver `lib/capi-credential.ts`).
 *
 * DEDUPLICAÇÃO: `eventId` tem de ser o MESMO valor que o navegador mandou no `eventID` do fbq,
 * para o mesmo `eventName`. É esse par que faz o Meta entender que o evento do navegador e o do
 * servidor são o MESMO lead. Sem isso ele conta os dois e o cliente otimiza campanha em cima do
 * dobro de conversões — pior que não ter CAPI.
 */

const META_API_URL = 'https://graph.facebook.com/v21.0'

/**
 * SHA-256 hash a string for Meta Advanced Matching.
 * Trims, lowercases, and normalizes before hashing.
 */
async function sha256Normalize(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const normalized = data.trim().toLowerCase().replace(/\s+/g, '')
  const buffer = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface MetaCAPIPayload {
  event_name: string
  event_time: number
  event_id: string
  action_source: 'website' | 'email' | 'app' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'other'
  event_source_url?: string
  user_data: {
    em?: string[]       // hashed email
    ph?: string[]       // hashed phone
    fn?: string[]       // hashed first name
    ln?: string[]       // hashed last name
    client_ip_address?: string
    client_user_agent?: string
  }
  custom_data?: Record<string, unknown>
}

export interface MetaCAPIOptions {
  /** Pixel DO CLIENTE, lido do formulário. Sem ele não há envio. */
  pixelId: string
  /** Token DO CLIENTE, já decifrado. Sem ele não há envio. */
  accessToken: string
  /** Nome real do evento (o mesmo que o navegador disparou), não mais 'Lead' fixo. */
  eventName: string
  /** Identificador do evento — TEM de casar com o `eventID` enviado pelo fbq no navegador. */
  eventId: string
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  ip?: string
  userAgent?: string
  formTitle?: string
  eventSourceUrl?: string
}

/**
 * Send a conversion event to Meta CAPI.
 * Fire-and-forget — never throws. Returns success boolean for logging only.
 */
export async function sendMetaCAPIEvent(options: MetaCAPIOptions): Promise<boolean> {
  const { accessToken, pixelId } = options

  // Sem credencial DO FORMULÁRIO não sai nada. Nunca cair num pixel global: era exatamente esse
  // fallback que mandava o lead do cliente para a conta da plataforma.
  if (!accessToken || !pixelId) {
    return false
  }
  // Pixel do Meta é numérico. Barra aqui um valor colado errado antes de virar POST.
  if (!/^\d{5,25}$/.test(pixelId)) {
    return false
  }
  if (!options.eventName || options.eventName.length > 64) {
    return false
  }

  // Defesa em profundidade (auditoria 2026-08, lote 2 · L2-6). O teto de fan-out vive na
  // ENTRADA (`/api/responses`), que é onde ele resolve banco e CAPI de uma vez. Este guard
  // existe para o caso de um chamador FUTURO esquecer de limitar: nome de evento do Meta não
  // passa de 64 caracteres, então string maior é lixo ou payload de abuso — não vale um POST.
  if (!options.eventId || options.eventId.length > 64) {
    return false
  }

  try {
    // Build hashed user_data (snake_case keys per Meta CAPI spec)
    const userData: MetaCAPIPayload['user_data'] = {}

    // Valida o formato antes do hash (P3): lixo hasheado vira hash "válido"
    // que polui o matching do Meta sem nunca casar com usuário real.
    if (options.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(options.email.trim())) {
      userData.em = [await sha256Normalize(options.email)]
    }
    if (options.phone) {
      const digitsOnly = options.phone.replace(/\D/g, '')
      // E.164 plausível: 8–15 dígitos (P3). Abaixo de 8 é quase sempre lixo
      // (campo vazio, "0", máscara incompleta) e só polui o matching do Meta.
      if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
        userData.ph = [await sha256Normalize(digitsOnly)]
      }
    }
    if (options.firstName) {
      userData.fn = [await sha256Normalize(options.firstName)]
    }
    if (options.lastName) {
      userData.ln = [await sha256Normalize(options.lastName)]
    }
    if (options.ip) {
      userData.client_ip_address = options.ip
    }
    if (options.userAgent) {
      userData.client_user_agent = options.userAgent
    }

    const payload: MetaCAPIPayload = {
      // O nome REAL do evento. Antes era 'Lead' fixo: um formulário que disparasse
      // 'FormStarted' no navegador virava 'Lead' no servidor, e o Meta registrava uma conversão
      // que não aconteceu.
      event_name: options.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: options.eventId,
      action_source: 'website',
      ...(options.eventSourceUrl && { event_source_url: options.eventSourceUrl }),
      user_data: userData,
      ...(options.formTitle && { custom_data: { form_title: options.formTitle } }),
    }

    // `META_TEST_EVENT_CODE` foi REMOVIDO em 18/08/2026. Era uma variável GLOBAL, e evento com
    // test_event_code não conta para otimização de campanha: com CAPI por cliente, um código
    // esquecido no ambiente anularia as conversões de TODOS os clientes ao mesmo tempo, sem erro
    // e sem aviso. Para depurar, use a aba "Eventos de teste" do Events Manager do próprio cliente.

    const url = `${META_API_URL}/${pixelId}/events?access_token=${accessToken}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: accessToken,
      }),
    })

    if (!response.ok) {
      // Sem o corpo cru e sem a URL: a URL leva o access_token na query, e log é lido por gente
      // que não deveria ter a credencial do cliente. Trecho curto basta para diagnosticar.
      const detalhe = (await response.text()).slice(0, 300)
      console.error('[Meta CAPI] falhou', { status: response.status, pixelId, detalhe })
      return false
    }

    console.log('[Meta CAPI] evento enviado', { pixelId, eventName: options.eventName })
    return true
  } catch (err) {
    console.error('[Meta CAPI] Error:', err)
    return false
  }
}

/**
 * Extract PII fields from form answers for Meta CAPI.
 * Looks for common field types: email, phone, name/first_name/last_name.
 */
export function extractPIIFromAnswers(
  answers: Record<string, unknown>,
  questions: Array<{ id: string; type?: string; title?: string; fields?: Array<{ id: string; ref?: string }> }>
): { email?: string; phone?: string; firstName?: string; lastName?: string } {
  const result: { email?: string; phone?: string; firstName?: string; lastName?: string } = {}

  for (const question of questions) {
    const value = answers[question.id]
    if (typeof value !== 'string' && typeof value !== 'object') continue

    const qType = question.type?.toLowerCase() ?? ''
    const qTitle = question.title?.toLowerCase() ?? ''

    if (qType === 'email' || qTitle.includes('email') || qTitle.includes('e-mail')) {
      const email = typeof value === 'string' ? value : null
      if (email && email.includes('@')) result.email = email
    }

    if (qType === 'phone' || qType === 'tel' || qTitle.includes('telefone') || qTitle.includes('phone') || qTitle.includes('whatsapp') || qTitle.includes('celular')) {
      const phone = typeof value === 'string' ? value : null
      if (phone) result.phone = phone
    }

    // Name fields — full name or split
    if (qType === 'name' || qTitle.includes('nome')) {
      const name = typeof value === 'string' ? value.trim() : null
      if (name) {
        const parts = name.split(/\s+/)
        result.firstName = parts[0]
        if (parts.length > 1) {
          result.lastName = parts.slice(1).join(' ')
        }
      }
    }

    // Short text with name-like title
    if (qType === 'short_text' && !result.firstName) {
      if (qTitle.includes('primeiro nome') || qTitle.includes('first name')) {
        const v = typeof value === 'string' ? value.trim() : null
        if (v) result.firstName = v
      }
      if (qTitle.includes('sobrenome') || qTitle.includes('last name')) {
        const v = typeof value === 'string' ? value.trim() : null
        if (v) result.lastName = v
      }
    }
  }

  return result
}


/**
 * Confere, NA HORA DE SALVAR, se o token realmente tem permissão naquele pixel.
 *
 * Por que validar em vez de só guardar: sem isto, um token colado errado falha em silêncio para
 * sempre — o cliente acha que configurou, nenhuma conversão chega, e não há nada na tela que
 * indique o problema. Um "não deu certo" no momento do save é a diferença entre um campo que
 * funciona e um campo que engana.
 *
 * A consulta é de LEITURA (`GET /{pixel-id}`): não cria evento nem polui a conta do cliente. Se o
 * token não tiver permissão naquele pixel, o Meta recusa — que é exatamente o que queremos saber.
 */
export async function validarCredencialCapi(
  pixelId: string,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (!/^\d{5,25}$/.test(pixelId)) {
    return { ok: false, motivo: 'O Pixel ID deve conter apenas números. Confira no Gerenciador de Eventos.' }
  }
  if (!accessToken || accessToken.length < 20) {
    return { ok: false, motivo: 'Token muito curto — parece incompleto.' }
  }
  try {
    const r = await fetch(`${META_API_URL}/${pixelId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (r.ok) return { ok: true }

    const corpo = await r.json().catch(() => null) as { error?: { code?: number; message?: string } } | null
    const codigo = corpo?.error?.code
    // Traduzido: a mensagem crua do Meta vem em inglês e fala de "object" e "node", que não
    // significam nada para quem só quer saber se colou o token certo.
    if (codigo === 190) return { ok: false, motivo: 'Token inválido ou expirado. Gere um novo no Gerenciador de Eventos.' }
    if (codigo === 100 || r.status === 404) {
      return { ok: false, motivo: 'Este token não tem acesso a este Pixel. Confira se os dois são da mesma conta.' }
    }
    if (codigo === 200 || r.status === 403) {
      return { ok: false, motivo: 'O token existe, mas não tem permissão para enviar eventos deste Pixel.' }
    }
    return { ok: false, motivo: 'O Meta recusou a validação. Confira o Pixel e o token e tente de novo.' }
  } catch {
    // Rede/timeout NÃO é token inválido. Recusar o save aqui faria o cliente apagar e recolar um
    // token que estava certo. Ele é guardado como não-validado e a interface diz isso.
    return { ok: false, motivo: 'Não foi possível falar com o Meta agora. O token foi salvo, mas ainda não validado.' }
  }
}

/**
 * QUEM É ENVIADO PELO SERVIDOR — a regra, separada do encanamento.
 *
 * Mesma disciplina do `decidirAviso` da régua de cobrança: a decisão vive numa função pura, que
 * dá para testar sem banco, sem rede e sem formulário. O que estava inline na rota de submit era
 * exatamente o tipo de lógica que ninguém consegue cobrir depois.
 *
 * As três recusas, e por que cada uma existe:
 *
 *  1. SEM PIXEL ou SEM TOKEN do formulário → nada sai. Nunca cair num pixel global: era esse
 *     fallback que mandava o lead do cliente para a conta da plataforma.
 *  2. EVENTO SEM ID do navegador → não sai. Sem o par (nome, id) o Meta não deduplica, e o
 *     cliente veria a MESMA conversão contada duas vezes. Para ele, evento a menos é melhor que
 *     conversão inflada: número inflado ele usa para decidir orçamento.
 *  3. PLANO sem o recurso → nada sai (o mesmo portão dos pixels).
 */
export function decidirEnviosCapi(params: {
  planoPermite: boolean
  pixelId: string | null | undefined
  token: string | null | undefined
  eventos: string[]
  eventIds: Record<string, string>
}): Array<{ eventName: string; eventId: string }> {
  const { planoPermite, pixelId, token, eventos, eventIds } = params
  if (!planoPermite) return []
  if (!pixelId || !pixelId.trim()) return []
  if (!token) return []
  return eventos
    .map((eventName) => ({ eventName, eventId: eventIds[eventName] }))
    .filter((e): e is { eventName: string; eventId: string } => Boolean(e.eventId))
}
