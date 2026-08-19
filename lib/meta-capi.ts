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

import { log, logError } from '@/lib/logger'

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
  /** Valor da conversão, vindo da CONFIGURAÇÃO do evento (nunca do POST público). */
  value?: number
  currency?: string
  /**
   * Código de teste do Gerenciador de Eventos, POR FORMULÁRIO e temporário.
   * ⚠️ Evento com este código NÃO conta para otimização de campanha — por isso ele expira sozinho
   * (ver `codigoDeTesteValido`). A versão global disto foi removida hoje justamente porque um
   * código esquecido no ambiente anularia as conversões de todos os clientes de uma vez.
   */
  testEventCode?: string
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
      // `value`/`currency` são o que permite a campanha otimizar por receita em vez de por
      // volume. Sem eles, um `Purchase` chega ao Meta valendo nada.
      ...((options.formTitle || typeof options.value === 'number') && {
        custom_data: {
          ...(options.formTitle ? { form_title: options.formTitle } : {}),
          ...(typeof options.value === 'number' ? { value: options.value, currency: options.currency || 'BRL' } : {}),
        },
      }),
    }

    // `META_TEST_EVENT_CODE` foi REMOVIDO em 18/08/2026. Era uma variável GLOBAL, e evento com
    // test_event_code não conta para otimização de campanha: com CAPI por cliente, um código
    // esquecido no ambiente anularia as conversões de TODOS os clientes ao mesmo tempo, sem erro
    // e sem aviso. Para depurar, use a aba "Eventos de teste" do Events Manager do próprio cliente.

    // ⚠️ O token NÃO vai na query string (parecer independente, 18/08). URL entra em telemetria,
    // trace e objeto de erro; o corpo, não. Um mecanismo só de autenticação, no corpo.
    const url = `${META_API_URL}/${pixelId}/events`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: accessToken,
        ...(options.testEventCode ? { test_event_code: options.testEventCode } : {}),
      }),
    })

    if (!response.ok) {
      // Sem o corpo cru e sem a URL: a URL leva o access_token na query, e log é lido por gente
      // que não deveria ter a credencial do cliente. Trecho curto basta para diagnosticar.
      const detalhe = (await response.text()).slice(0, 300)
      logError('[Meta CAPI] falhou', null, { status: response.status, pixelId, detalhe })
      return false
    }

    log('[Meta CAPI] evento enviado', { pixelId, eventName: options.eventName })
    return true
  } catch (err) {
    logError('[Meta CAPI] erro no envio', err, { pixelId })
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
export type VereditoCapi =
  | { estado: 'ok'; conclusivo: boolean }
  /** O Meta respondeu e RECUSOU. Definitivo: não adianta tentar de novo com o mesmo token. */
  | { estado: 'recusado'; motivo: string }
  /** Não deu para saber (rede, timeout, 429, 5xx). NÃO é token inválido — não trate como tal. */
  | { estado: 'temporario'; motivo: string }

/**
 * Confere, NA HORA DE SALVAR, se o token pode MANDAR EVENTO naquele pixel.
 *
 * ⚠️ CORRIGIDO EM 18/08/2026, no primeiro teste real do Sidney. A primeira versão fazia
 * `GET /{pixel-id}` — uma LEITURA. O token gerado pelo fluxo "sem a Dataset Quality API" do
 * Gerenciador de Eventos serve para ENVIAR evento e não necessariamente para ler o objeto do
 * pixel: um token perfeitamente bom era reprovado numa prova que não era a dele. O parecer
 * independente já tinha avisado que a leitura "não prova rigorosamente que consegue enviar";
 * o teste real confirmou na prática.
 *
 * A prova agora exercita a permissão QUE IMPORTA: um POST no endpoint de eventos com a lista
 * VAZIA. Verificado experimentalmente que o Meta autentica ANTES de validar o payload — token
 * ruim devolve 190 mesmo com `data: []`. E lista vazia não cria evento nenhum: nada é poluído
 * na conta do cliente.
 */
export async function validarCredencialCapi(
  pixelId: string,
  accessToken: string,
): Promise<VereditoCapi> {
  if (!/^\d{5,25}$/.test(pixelId)) {
    return { estado: 'recusado', motivo: 'O Pixel ID deve conter apenas números. Confira no Gerenciador de Eventos.' }
  }
  if (!accessToken || accessToken.length < 20) {
    return { estado: 'recusado', motivo: 'Token muito curto — parece incompleto.' }
  }
  try {
    const r = await fetch(`${META_API_URL}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Lista vazia: prova a permissão sem gerar conversão na conta de ninguém.
      body: JSON.stringify({ data: [], access_token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    })
    if (r.ok) return { estado: 'ok', conclusivo: true }

    // 429 e 5xx são do LADO DELES. Recusar aqui faria o cliente apagar e recolar um token que
    // estava certo — e perderia a credencial que já funcionava.
    if (r.status === 429 || r.status >= 500) {
      return { estado: 'temporario', motivo: 'O Meta está indisponível ou limitou as consultas agora. Tente de novo em alguns minutos.' }
    }

    const corpo = await r.json().catch(() => null) as { error?: { code?: number; message?: string } } | null
    const codigo = corpo?.error?.code
    const mensagem = String(corpo?.error?.message ?? '')

    if (codigo === 190) {
      return { estado: 'recusado', motivo: 'Token inválido ou expirado. Gere um novo no Gerenciador de Eventos.' }
    }
    if (codigo === 200 || codigo === 10 || r.status === 403) {
      return { estado: 'recusado', motivo: 'O token não tem permissão para enviar eventos deste Pixel. Confira se os dois são da mesma conta.' }
    }
    if (codigo === 803) {
      return { estado: 'recusado', motivo: 'Pixel não encontrado. Confira o Pixel ID no Gerenciador de Eventos.' }
    }
    // O código 100 é "parâmetro inválido" de forma GERAL. Neste POST ele significa quase sempre
    // "faltou o data" — ou seja, o token JÁ PASSOU pela autenticação e pela permissão. A exceção
    // é o objeto inexistente/sem acesso, que o Meta descreve com esta frase padrão.
    if (codigo === 100) {
      if (/does not exist|missing permissions|cannot be loaded/i.test(mensagem)) {
        return { estado: 'recusado', motivo: 'O Meta não encontrou este Pixel com este token. Confira se o Pixel ID está certo e se o token é da mesma conta.' }
      }
      // Passou na autenticação, mas quem reclamou foi o payload: não temos prova POSITIVA de
      // envio. Guardamos e dizemos isso na tela, em vez de reprovar um token provavelmente bom.
      return { estado: 'ok', conclusivo: false }
    }
    return { estado: 'recusado', motivo: 'O Meta recusou a validação. Confira o Pixel e o token e tente de novo.' }
  } catch {
    return { estado: 'temporario', motivo: 'Não foi possível falar com o Meta agora. Nada foi alterado — tente de novo em instantes.' }
  }
}

/**
 * QUEM É ENVIADO PELO SERVIDOR — a regra, separada do encanamento.
 *
 * Mesma disciplina do `decidirAviso` da régua de cobrança: a decisão vive numa função pura, que
 * dá para testar sem banco, sem rede e sem formulário.
 *
 * As recusas, e por que cada uma existe:
 *
 *  1. SEM PIXEL ou SEM TOKEN do formulário → nada sai. Nunca cair num pixel global: era esse
 *     fallback que mandava o lead do cliente para a conta da plataforma.
 *  2. PIXEL TROCADO depois da validação → nada sai. O token foi validado contra um pixel
 *     específico; se o dono trocou o Pixel ID e não revalidou, o par não é mais o que aprovamos.
 *     (Achado do parecer independente: a validação deixava de valer em silêncio.)
 *  3. EVENTO QUE O DONO NÃO CONFIGUROU → não sai. O submit é anônimo; sem isto, um estranho
 *     mandaria `Purchase` no pixel do cliente usando o token verdadeiro dele. Quem autoriza é a
 *     configuração gravada do formulário (`derivarEventosAutorizados`), nunca o corpo do POST.
 *  4. OCORRÊNCIA SEM ID do navegador → não sai. Sem o par (nome, id) o Meta não deduplica, e o
 *     cliente veria a MESMA conversão contada duas vezes. Para ele, evento a menos é melhor que
 *     conversão inflada: número inflado ele usa para decidir orçamento.
 *  5. PLANO sem o recurso → nada sai (o mesmo portão dos pixels).
 */
export function decidirEnviosCapi(params: {
  planoPermite: boolean
  pixelId: string | null | undefined
  token: string | null | undefined
  /** Pixel contra o qual o token foi validado. `null` = credencial antiga, sem registro. */
  pixelValidado?: string | null
  /** Uma entrada por DISPARO do navegador — o Meta exige event_id único por ocorrência. */
  ocorrencias: Array<{ name: string; id: string }>
  /** O que a CONFIGURAÇÃO do formulário autoriza, derivado no servidor. */
  autorizados: Map<string, { value?: number; currency?: string } | null>
}): Array<{ eventName: string; eventId: string; value?: number; currency?: string }> {
  const { planoPermite, pixelId, token, pixelValidado, ocorrencias, autorizados } = params
  if (!planoPermite) return []
  if (!pixelId || !pixelId.trim()) return []
  if (!token) return []
  if (pixelValidado && pixelValidado.trim() !== pixelId.trim()) return []

  const vistos = new Set<string>()
  const nomesJaEnviados = new Set<string>()
  const saida: Array<{ eventName: string; eventId: string; value?: number; currency?: string }> = []
  for (const o of ocorrencias) {
    if (!o?.name || !o?.id) continue
    if (!autorizados.has(o.name)) continue
    // ⚠️ TETO DE UMA OCORRÊNCIA POR NOME — mitigação do P0 achado no 2º parecer independente
    // (18/08/2026). A autorização limitava QUAIS nomes, não QUANTOS: com `Purchase` legitimamente
    // configurado, um POST forjado com 50 ocorrências gerava 50 conversões reais na conta de
    // anúncios do cliente, autenticadas com o token dele. Inflar conversão de terceiro é
    // sabotagem barata — o Meta passa a entregar o anúncio para público lixo.
    //
    // Este teto NÃO tira nada do fluxo legítimo: hoje `metaEvents` já é deduplicado por nome, e o
    // navegador dispara no máximo uma vez por nome num submit.
    //
    // É MITIGAÇÃO, NÃO A CORREÇÃO. A correção é o servidor DERIVAR os gatilhos e devolver ao
    // navegador o que disparar, com um evento por gatilho — aí a cardinalidade vira propriedade
    // estrutural em vez de checagem. Enquanto isso não existe, o teto fecha a amplificação.
    if (nomesJaEnviados.has(o.name)) continue
    // Id repetido no mesmo POST é entrada malformada (ou adulterada): manda uma vez só.
    if (vistos.has(o.id)) continue
    vistos.add(o.id)
    nomesJaEnviados.add(o.name)
    const cfg = autorizados.get(o.name)
    saida.push({
      eventName: o.name,
      eventId: o.id,
      // `value`/`currency` vêm da CONFIGURAÇÃO, nunca do POST — senão o valor da conversão
      // também seria escolhido por quem manda o formulário.
      ...(typeof cfg?.value === 'number' ? { value: cfg.value } : {}),
      ...(cfg?.currency ? { currency: cfg.currency } : {}),
    })
  }
  return saida
}


/** Quanto tempo um código de teste continua valendo. Curto: é para conferir, não para viver. */
export const VALIDADE_CODIGO_TESTE_H = 3

/**
 * O código de teste ainda vale?
 *
 * Existe porque código de teste é uma FACA: evento marcado como teste não conta para a otimização
 * da campanha. Um código esquecido no formulário zeraria as conversões daquele cliente em
 * silêncio — exatamente o risco que fez a variável global ser removida em 18/08/2026.
 *
 * Expirar sozinho transforma o esquecimento em não-evento: passou de {@link VALIDADE_CODIGO_TESTE_H}
 * horas, o envio volta a ser normal sem ninguém precisar lembrar de nada.
 */
export function codigoDeTesteValido(
  codigo: unknown,
  marcadoEm: unknown,
  agora: number = Date.now(),
): string | null {
  if (typeof codigo !== 'string') return null
  const limpo = codigo.trim()
  // Formato do Meta: TEST seguido de dígitos. Barra colagem errada antes de virar envio.
  if (!/^TEST[A-Za-z0-9]{2,20}$/.test(limpo)) return null
  if (typeof marcadoEm !== 'string') return null
  const t = Date.parse(marcadoEm)
  if (Number.isNaN(t)) return null
  if (agora - t > VALIDADE_CODIGO_TESTE_H * 3600_000) return null
  // Marca no futuro (relógio torto ou payload adulterado) não vale.
  if (t - agora > 5 * 60_000) return null
  return limpo
}
