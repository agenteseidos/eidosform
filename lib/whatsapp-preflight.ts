/**
 * lib/whatsapp-preflight.ts — o porteiro do canal WhatsApp da régua (S1, auditoria 14/08).
 *
 * POR QUE EXISTE: o envio publicava pelo NOME do template e pronto. Como a Meta recategoriza
 * DEPOIS de aprovar — foi exatamente o que aconteceu com `eidosform_plano_rebaixado_v1`, que
 * virou MARKETING ainda em análise —, a régua seguiria disparando MARKETING sem ninguém ver.
 * Isso viola a regra dura do Sidney (22/07, repetida 3×): **só UTILITY, sem exceção**.
 *
 * O teste de contrato local NÃO cobre isto e nunca vai cobrir: ele lê o JSON do repositório,
 * e o JSON continua dizendo UTILITY enquanto a Meta já mudou a categoria. Um é a intenção;
 * este módulo é o estado real.
 *
 * FAIL-CLOSED por desenho. Cobrança é mensagem não solicitada: na dúvida, não manda. Silêncio
 * custa um lembrete; disparo indevido custa a reputação do número (e, com ela, todos os
 * avisos transacionais legítimos que dependem dele).
 */
import { log, logError, logWarn } from '@/lib/logger'

export type PreflightResult =
  | { pode: true; quality: string }
  | { pode: false; motivo: string; detalhe?: string }

type TemplateInfo = { name: string; status: string; category: string }

/** Cache curto: a régua percorre N perfis por rodada e a resposta é a mesma para todos. */
const CACHE_MS = 120_000
let cache: { em: number; resultado: PreflightResult } | null = null

function creds(): { token: string; wabaId: string; phoneId: string } | null {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const wabaId = process.env.WHATSAPP_WABA_ID
  const phoneId = process.env.WHATSAPP_CLOUD_PHONE_ID
  if (!token || !wabaId || !phoneId) return null
  return { token, wabaId, phoneId }
}

async function graph(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`graph ${res.status}`)
  return res.json()
}

/**
 * O canal pode disparar AGORA? Confere, na Meta:
 *  · todo template da régua está APPROVED **e** UTILITY;
 *  · o número não está com qualidade degradada (o mesmo sinal que pausa campanha na Elen).
 *
 * `templates` é a lista canônica de `DUNNING_WHATSAPP_TEMPLATES` — passada pelo chamador para
 * este módulo não depender do conteúdo, e para o teste poder exercitar nomes arbitrários.
 */
export async function preflightWhatsAppDunning(templates: string[], agora = Date.now()): Promise<PreflightResult> {
  if (cache && agora - cache.em < CACHE_MS) return cache.resultado

  const guardar = (resultado: PreflightResult): PreflightResult => {
    cache = { em: agora, resultado }
    return resultado
  }

  const c = creds()
  if (!c) return guardar({ pode: false, motivo: 'credenciais_ausentes' })
  if (!templates.length) return guardar({ pode: false, motivo: 'sem_templates' })

  const base = 'https://graph.facebook.com/v21.0'
  try {
    const nomes = encodeURIComponent(JSON.stringify(templates))
    const [tpl, num] = await Promise.all([
      graph(`${base}/${c.wabaId}/message_templates?name=${nomes}&limit=50`, c.token),
      graph(`${base}/${c.phoneId}?fields=quality_rating`, c.token),
    ])

    const lista = ((tpl as { data?: TemplateInfo[] })?.data ?? [])
    for (const nome of templates) {
      // Mesmo nome pode ter várias linhas (idiomas). TODAS precisam servir: um pt_BR aprovado
      // não salva se a linha que o envio casar estiver reprovada.
      const linhas = lista.filter((t) => t.name === nome)
      if (!linhas.length) {
        return guardar({ pode: false, motivo: 'template_inexistente', detalhe: nome })
      }
      const reprovado = linhas.find((t) => t.status !== 'APPROVED')
      if (reprovado) {
        return guardar({ pode: false, motivo: 'template_nao_aprovado', detalhe: `${nome}=${reprovado.status}` })
      }
      const naoUtility = linhas.find((t) => t.category !== 'UTILITY')
      if (naoUtility) {
        // O caso que motivou o módulo. Alto o suficiente para virar alerta de operação.
        logError('[wpp-preflight] 🔴 template da régua NÃO é UTILITY — canal bloqueado', undefined, {
          template: nome, categoria: naoUtility.category,
        })
        return guardar({ pode: false, motivo: 'template_nao_utility', detalhe: `${nome}=${naoUtility.category}` })
      }
    }

    const quality = String((num as { quality_rating?: string })?.quality_rating ?? '')
    // GREEN libera; YELLOW/RED/UNKNOWN seguram. É o mesmo critério do motor de campanha da
    // Elen — cobrança não é hora de gastar reputação já arranhada.
    if (quality !== 'GREEN') {
      logWarn('[wpp-preflight] qualidade do número fora do verde — canal bloqueado', { quality })
      return guardar({ pode: false, motivo: 'qualidade_degradada', detalhe: quality || 'desconhecida' })
    }

    log('[wpp-preflight] canal liberado', { templates: templates.length, quality })
    return guardar({ pode: true, quality })
  } catch (err) {
    // Erro de rede/token = NÃO SABEMOS. Fail-closed: não manda e não cacheia por muito tempo.
    logError('[wpp-preflight] consulta à Meta falhou — canal bloqueado (fail-closed)', err)
    return guardar({ pode: false, motivo: 'consulta_falhou', detalhe: String(err).slice(0, 80) })
  }
}

/** Só para teste: zera o cache entre casos. */
export function resetPreflightCache(): void {
  cache = null
}
