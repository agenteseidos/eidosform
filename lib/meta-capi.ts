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


// ── ENVIO DE UMA LINHA DA FILA (worker) ───────────────────────────────────────────────────────

export type ResultadoEnvio =
  | { tipo: 'enviado' }
  /** O Meta recusou por AUTENTICAÇÃO/permissão: não adianta tentar de novo com este token. */
  | { tipo: 'bloqueado_auth'; codigo?: number }
  /** Falha passageira (rede, timeout, 429, 5xx, is_transient): tentar de novo com backoff. */
  | { tipo: 'retentavel'; codigo?: number; retryAfterS?: number }
  /** O payload em si é inválido: repetir daria o mesmo erro para sempre. */
  | { tipo: 'morto'; codigo?: number }

/**
 * Envia UM evento já materializado (snapshot da fila — PII pré-hasheada) e CLASSIFICA o desfecho.
 *
 * Por que classificar em vez de devolver boolean: o worker precisa distinguir "token revogado"
 * (parar de bater de hora em hora, marcar blocked_auth, religar quando trocarem o token) de
 * "Meta fora do ar" (retentar com backoff) de "payload podre" (morrer na hora). O envio antigo
 * devolvia `false` para tudo — e o chamador não tinha como reagir certo.
 *
 * ⚠️ LOG SÓ COM CAMPOS ESTRUTURADOS (parecer independente): status, error.code, error_subcode,
 * is_transient e fbtrace_id. NUNCA o corpo cru — se o Meta ou um intermediário ecoar a
 * credencial, ela pararia no log; o redator central mascara chaves chamadas "token", não tokens
 * dentro de uma string arbitrária.
 */
export async function enviarLinhaCapi(params: {
  pixelId: string
  accessToken: string
  eventName: string
  eventId: string
  /** ISO — vira Unix seconds no payload. É o event_time do SNAPSHOT, não o de agora. */
  eventTime: string
  userData: Record<string, unknown>
  value?: number | null
  currency?: string | null
  actionSource?: string
  eventSourceUrl?: string | null
  testEventCode?: string | null
}): Promise<ResultadoEnvio> {
  const eventTimeS = Math.floor(Date.parse(params.eventTime) / 1000)
  if (Number.isNaN(eventTimeS)) return { tipo: 'morto' }

  const payload: Record<string, unknown> = {
    event_name: params.eventName,
    event_time: eventTimeS,
    event_id: params.eventId,
    action_source: params.actionSource || 'website',
    ...(params.eventSourceUrl ? { event_source_url: params.eventSourceUrl } : {}),
    user_data: params.userData,
    ...(typeof params.value === 'number'
      ? { custom_data: { value: params.value, currency: params.currency || 'BRL' } }
      : {}),
  }

  try {
    const r = await fetch(`${META_API_URL}/${params.pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: params.accessToken,
        ...(params.testEventCode ? { test_event_code: params.testEventCode } : {}),
      }),
      // Timeout que o envio em runtime NUNCA teve (só a validação tinha) — achado do parecer.
      signal: AbortSignal.timeout(10_000),
    })

    if (r.ok) {
      log('[capi-worker] evento entregue', { pixelId: params.pixelId, eventName: params.eventName })
      return { tipo: 'enviado' }
    }

    const retryAfterS = Number(r.headers.get('retry-after')) || undefined
    const corpo = await r.json().catch(() => null) as {
      error?: { code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string }
    } | null
    const e = corpo?.error
    logError('[capi-worker] envio recusado', null, {
      status: r.status, codigo: e?.code, subcodigo: e?.error_subcode,
      transiente: e?.is_transient, trace: e?.fbtrace_id, pixelId: params.pixelId,
    })

    if (e?.is_transient || r.status === 429 || r.status >= 500) {
      return { tipo: 'retentavel', codigo: e?.code, retryAfterS }
    }
    // 190 = token inválido/expirado · 200/10 = sem permissão · 803 = pixel não existe p/ este token
    if (e?.code === 190 || e?.code === 200 || e?.code === 10 || e?.code === 803 || r.status === 401 || r.status === 403) {
      return { tipo: 'bloqueado_auth', codigo: e?.code }
    }
    return { tipo: 'morto', codigo: e?.code }
  } catch {
    // Rede/timeout: AMBÍGUO — o Meta pode ter aceitado e a resposta se perdido. Retentar com o
    // MESMO event_id é o comportamento certo: dentro da janela de dedup, duplicata é descartada.
    return { tipo: 'retentavel' }
  }
}
