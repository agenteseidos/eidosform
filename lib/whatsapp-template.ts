/**
 * Template da notificação de lead por WhatsApp — CONSTANTE ÚNICA + buildMessage.
 *
 * Centralizado aqui (auditoria Codex 2026-07-23) porque o default vivia triplicado
 * (painel, lib/whatsapp.ts, fallback do send) e o buildMessage vivia dentro da rota.
 * Este módulo é puro (sem deps de servidor) — importável por client e server.
 */

export const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE = [
  '🔔 *Novo lead* em {form_name}',
  '',
  '{respostas}',
  '',
  '💬 Responder: {whatsapp_link}',
  '🕒 Recebido {data} às {horario}',
  '*Eventos Meta:* {meta_events}',
].join('\n')

/** Template FIXO do alerta de lead abandonado (não editável pelo usuário na v1). */
export const ABANDONED_LEAD_TEMPLATE = [
  '⚠️ *Lead incompleto* em {form_name}',
  'Começou a preencher há {abandono_minutos} min e não finalizou.',
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
}

/**
 * Normalize and sanitize a template value before substitution.
 * NFKC normalization prevents Unicode homoglyph injection (P1-N2).
 */
function normalizeValue(value: string): string {
  return value.normalize('NFKC')
}

/** Remove do template a(s) linha(s) que contêm o placeholder (self-hide). */
function dropLineWith(msg: string, placeholder: RegExp): string {
  return msg.replace(new RegExp(`^.*${placeholder.source}.*(?:\\r?\\n|$)`, 'gim'), '')
}

/**
 * Build message from template and lead data.
 * - {form_name} sai em *negrito* (só na mensagem, não na UI).
 * - {meta_events} e {whatsapp_link} apagam a LINHA inteira quando não há valor.
 * - {whatsapp_link}: link wa.me com telefone NORMALIZADO (só dígitos) — nunca usar
 *   {telefone} cru numa URL (pode vir com +, espaços, máscara). Decisão Codex.
 */
export function buildMessage(template: string, leadData: Record<string, unknown>): string {
  let msg = template.normalize('NFKC')

  // {whatsapp_link}: telefone → só dígitos; some a linha se não houver telefone útil
  const rawPhone = String(leadData.phone ?? leadData.telefone ?? '')
  const digits = rawPhone.replace(/\D/g, '')
  if (digits.length >= 10 && digits.length <= 15) {
    msg = msg.replace(/\{whatsapp_link\}/gi, `https://wa.me/${digits}`)
  } else {
    msg = dropLineWith(msg, /\{whatsapp_link\}/)
  }

  // Named variables (higher priority). Aceita variantes com hífen (ex.: {e-mail}).
  msg = msg.replace(/\{form_name\}/gi, `*${normalizeValue(String(leadData.form_name || 'Formulário'))}*`)
  msg = msg.replace(/\{nome\}/gi, normalizeValue(String(leadData.name || leadData.nome || 'Lead')))
  msg = msg.replace(/\{e-?mail\}/gi, normalizeValue(String(leadData.email || 'N/A')))
  msg = msg.replace(/\{phone\}/gi, normalizeValue(String(leadData.phone || leadData.telefone || 'N/A')))
  msg = msg.replace(/\{response_id\}/gi, normalizeValue(String(leadData.response_id || 'N/A')))
  msg = msg.replace(/\{response_link\}/gi, normalizeValue(String(leadData.response_link || 'N/A')))

  // {meta_events}: com eventos → substitui; SEM eventos → apaga a LINHA inteira
  const metaEventsValue = normalizeValue(String(leadData.meta_events || ''))
  if (metaEventsValue) msg = msg.replace(/\{meta_events\}/gi, metaEventsValue)
  else msg = dropLineWith(msg, /\{meta_events\}/)

  // Chaves restantes: casa por label normalizado (mappedAnswers etc.)
  const normalizeKey = (k: string) =>
    k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  const normalizedLead = new Map<string, unknown>()
  for (const [k, v] of Object.entries(leadData)) normalizedLead.set(normalizeKey(k), v)
  msg = msg.replace(/\{([^{}\n]+)\}/g, (match, rawKey: string) => {
    const nk = normalizeKey(String(rawKey))
    if (normalizedLead.has(nk)) return normalizeValue(String(normalizedLead.get(nk) ?? ''))
    return match // chave desconhecida: mantém literal em vez de apagar
  })

  // Colapsa buracos: um {respostas} vazio (lead abandonou na 1ª pergunta) ou
  // linhas self-hide deixam 3+ quebras seguidas. Máx. 1 linha em branco. Os
  // \n\n entre blocos de {respostas} (exatamente 2) são preservados.
  return msg.replace(/\n{3,}/g, '\n\n').trim()
}
