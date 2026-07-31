/**
 * Template da notificação de lead por WhatsApp — CONSTANTE ÚNICA + buildMessage.
 *
 * Centralizado aqui (auditoria Codex 2026-07-23) porque o default vivia triplicado
 * (painel, lib/whatsapp.ts, fallback do send) e o buildMessage vivia dentro da rota.
 * Este módulo é puro (sem deps de servidor) — importável por client e server.
 */

import { toWhatsAppDigits } from './phone'
// P2-7 mora em lib/text-sanitize.ts desde 2026-07-30 — o e-mail precisa da MESMA
// limpeza de invisíveis, e duplicar a regra seria perder as duas de vista.
import { sanitizeSingleLine, sanitizeMultiLine } from './text-sanitize'

export const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE = [
  '🔔 *Novo lead* em {form_name}',
  '',
  '{respostas}',
  '',
  '💬 Responder: {whatsapp_link}',
  '🕒 Recebido {data} às {horario}',
  '*Eventos Meta:* {meta_events}',
].join('\n')

/**
 * Template FIXO do alerta de lead abandonado (não editável pelo usuário na v1).
 * P2-8: o relógio virou "última atividade", então "começou a preencher há X min"
 * era semanticamente FALSO (o lead pode ter mexido por 20min e parado há 30).
 */
export const ABANDONED_LEAD_TEMPLATE = [
  '⚠️ *Lead incompleto* em {form_name}',
  'Sem atividade há {abandono_minutos} min — não finalizou.',
  '',
  '{respostas}',
  '',
  '💬 Responder: {whatsapp_link}',
  '*Eventos Meta:* {meta_events}',
].join('\n')

/** Dados de exemplo pro botão "enviar teste" renderizar o template de verdade. */
export const SAMPLE_LEAD_DATA: Record<string, unknown> = {
  name: 'João', nome: 'João', primeiro_nome: 'João',
  nome_completo: 'João da Silva (exemplo)',
  email: 'joao@exemplo.com',
  phone: '5511999990000', telefone: '5511999990000',
  form_name: 'Formulário de Exemplo',
  response_id: 'exemplo',
  response_link: 'https://eidosform.com.br',
  horario: '14:32', data: '23/07/2026', dia_semana: 'quarta-feira',
  respostas: '*Qual seu nome?*\nJoão da Silva\n\n*Seu WhatsApp?*\n5511999990000',
  meta_events: 'Lead, LeadQualificado',
  abandono_minutos: '30',
  origem: 'facebook · cpc · lancamento-julho',
  utm_source: 'facebook',
  utm_medium: 'cpc',
  utm_campaign: 'lancamento-julho',
  utm_term: 'formulario-online',
  utm_content: 'criativo-a',
}

/** Remove do template a(s) linha(s) que contêm o placeholder (self-hide). */
function dropLineWith(msg: string, placeholder: RegExp): string {
  return msg.replace(new RegExp(`^.*${placeholder.source}.*(?:\\r?\\n|$)`, 'gim'), '')
}

const normalizeKey = (k: string) =>
  k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

/**
 * Build message from template and lead data.
 * - {form_name} sai em *negrito* (só na mensagem, não na UI).
 * - {meta_events} e {whatsapp_link} apagam a LINHA inteira quando não há valor.
 * - {whatsapp_link}: wa.me com telefone normalizado via lib/phone (P2-3 — 10/11
 *   dígitos ganham DDI 55; fora da faixa a linha some, nunca chuta número).
 *
 * P2-7 — SUBSTITUIÇÃO EM PASSAGEM ÚNICA: antes os valores nomeados entravam
 * primeiro e DEPOIS rodava um replace genérico, então um valor do lead contendo
 * "{respostas}" era expandido. Agora cada placeholder do TEMPLATE é resolvido
 * uma vez só; o que entra não é reescaneado.
 */
export function buildMessage(template: string, leadData: Record<string, unknown>): string {
  let msg = template.normalize('NFKC')

  // Self-hide roda ANTES da interpolação — não pode ser acionado por conteúdo
  // do lead (confirmado pela auditoria).
  const waDigits = toWhatsAppDigits(leadData.phone ?? leadData.telefone)
  if (!waDigits) msg = dropLineWith(msg, /\{whatsapp_link\}/)

  const metaEventsValue = sanitizeSingleLine(leadData.meta_events)
  if (!metaEventsValue) msg = dropLineWith(msg, /\{meta_events\}/)

  // {origem}: mesma regra do e-mail — a maioria dos leads chega sem UTM e uma
  // linha "Origem:  ·" em toda notificação é ruído. Os {utm_*} individuais
  // NÃO somem (resolvem pra string vazia): quem quiser a linha auto-ocultável
  // usa {origem}.
  const origemValue = sanitizeSingleLine(leadData.origem)
  if (!origemValue) msg = dropLineWith(msg, /\{origem\}/)

  const normalizedLead = new Map<string, unknown>()
  for (const [k, v] of Object.entries(leadData)) normalizedLead.set(normalizeKey(k), v)

  // Resolve UM placeholder. `undefined` ⇒ mantém literal (chave desconhecida
  // não apaga conteúdo do usuário).
  const resolve = (rawKey: string): string | undefined => {
    const nk = normalizeKey(rawKey)
    switch (nk) {
      case 'whatsapplink':
        return waDigits ? `https://wa.me/${waDigits}` : ''
      case 'formname':
        return `*${sanitizeSingleLine(leadData.form_name || 'Formulário')}*`
      case 'nome':
      case 'name':
        return sanitizeSingleLine(leadData.name || leadData.nome || 'Lead')
      case 'email':
        return sanitizeSingleLine(leadData.email || 'N/A')
      case 'phone':
        return sanitizeSingleLine(leadData.phone || leadData.telefone || 'N/A')
      case 'responseid':
        return sanitizeSingleLine(leadData.response_id || 'N/A')
      case 'responselink':
        return sanitizeSingleLine(leadData.response_link || 'N/A')
      case 'metaevents':
        return metaEventsValue
      case 'origem':
        return origemValue
    }
    if (normalizedLead.has(nk)) return sanitizeMultiLine(normalizedLead.get(nk))
    return undefined
  }

  msg = msg.replace(/\{([^{}\n]+)\}/g, (match, rawKey: string) => {
    const value = resolve(String(rawKey))
    return value === undefined ? match : value
  })

  // Colapsa buracos: um {respostas} vazio (lead abandonou na 1ª pergunta) ou
  // linhas self-hide deixam 3+ quebras seguidas. Máx. 1 linha em branco. Os
  // \n\n entre blocos de {respostas} (exatamente 2) são preservados.
  return msg.replace(/\n{3,}/g, '\n\n').trim()
}
