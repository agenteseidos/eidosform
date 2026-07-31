/**
 * lib/notification-content.ts — ADAPTADOR DE E-MAIL do modelo neutro.
 *
 * Recebe um NotificationModel e devolve { subject, html, text }. É o único
 * lugar que sabe como um lead vira e-mail. Nada aqui faz I/O nem conhece a
 * Resend — quem envia é lib/notification-email.ts.
 *
 * ESCAPE (§4.6 do plano): TUDO que vem do lead ou do dono entra em HTML —
 * nome, título do formulário, TÍTULOS DAS PERGUNTAS, respostas, UTMs, nomes de
 * evento. A regra é sempre a mesma dupla: limpar invisíveis (lib/text-sanitize)
 * e DEPOIS escapar (escapeHtml). Assunto e corpo recebem tratamentos
 * diferentes de propósito — assunto é texto puro e ainda passa pelo
 * sanitizeSubject do sender (CR/LF, PII, truncamento).
 */

import { escapeHtml } from './html'
import { sanitizeSingleLine, sanitizeMultiLine } from './text-sanitize'
import { toWhatsAppDigits } from './phone'
import type { NotificationModel } from './notification-model'

export interface EmailContent {
  subject: string
  html: string
  text: string
}

const BRAND = '#6366f1'
const WHATSAPP_GREEN = '#25D366'
/** Mesmo âmbar do alerta de 80% do limite — sinaliza 'preciso da sua ação'. */
const WARNING = '#f59e0b'

/** Texto de uma linha, pronto pra HTML. */
const h1line = (v: unknown) => escapeHtml(sanitizeSingleLine(v))
/** Texto multi-linha, pronto pra HTML (quebras viram <br>). */
const hblock = (v: unknown) =>
  escapeHtml(sanitizeMultiLine(v)).replace(/\n/g, '<br>')

/**
 * Data e hora do EVENTO em horário de Brasília, a partir do timestamp
 * PERSISTIDO. Nunca do relógio do envio (§3.3 — numa retentativa o e-mail
 * mostraria a hora do aviso como se fosse a hora do lead).
 */
export function formatEventAt(eventAt: string): string {
  const d = new Date(eventAt)
  if (Number.isNaN(d.getTime())) return ''
  const sp = (parts: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...parts })
  const data = sp({ day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = sp({ hour: '2-digit', minute: '2-digit', hour12: false })
  return `${data} às ${hora}`
}

/** Valores de UTM presentes, na ordem canônica. Vazio ⇒ a linha some. */
function utmParts(model: NotificationModel): string[] {
  const { source, medium, campaign, term, content } = model.utm
  return [source, medium, campaign, term, content].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  )
}

/** Pares pergunta/resposta que têm o que mostrar nesta rendição. */
function visibleAnswers(model: NotificationModel) {
  return model.answers.filter((a) => a.question.trim() && a.value.trim())
}

/**
 * Rótulo OBRIGATÓRIO dos sinais de conversão (decisão 6 do plano). O servidor
 * conhece os nomes REGISTRADOS na resposta, não o resultado nos provedores:
 * os nomes entram no POST antes de os pixels do navegador dispararem e, na
 * CAPI, todo evento sai como `Lead`. Por isso nunca "eventos disparados",
 * "eventos entregues" nem "Eventos Meta".
 */
const CONVERSION_LABEL = 'Sinais de conversão registrados nesta resposta'
const CONVERSION_DISCLAIMER =
  'Indica os eventos registrados pelo EidosForm; não confirma recebimento pelas plataformas de anúncios.'

/**
 * O que muda entre os dois e-mails de lead. Tudo o mais — identidade, tabela de
 * respostas, origem, sinais de conversão, botões, escape — é o MESMO código,
 * para os dois avisos serem reconhecíveis como a mesma família.
 */
interface LeadEmailVariant {
  /** Prefixo do assunto: "Novo lead" / "Lead incompleto". */
  subjectPrefix: string
  /** Título dentro do e-mail. */
  heading: string
  /** Cor do título. */
  headingColor: string
  /** Linha logo abaixo do título, quando houver (ex.: "Sem atividade há…"). */
  lede?: string
  /** Rótulo do horário: "Recebido em" / "Última atividade". */
  timeLabel: string
  /** Título da tabela de respostas. */
  answersTitle: string
}

/** E-mail de NOVA RESPOSTA (Entrega 1). */
export function buildNewResponseEmail(model: NotificationModel): EmailContent {
  return renderLeadEmail(model, {
    subjectPrefix: 'Novo lead',
    heading: 'Novo lead 🎉',
    headingColor: BRAND,
    timeLabel: 'Recebido em',
    answersTitle: 'Respostas',
  })
}

/**
 * E-mail de LEAD ABANDONADO (Entrega 2) — começou a preencher e parou.
 *
 * A semântica do tempo é "SEM ATIVIDADE há X min", nunca "começou a preencher
 * há X min" (herdado da auditoria P2-8 do WhatsApp): o lead pode ter mexido no
 * formulário por 20 minutos e ter parado há 30. Dizer "começou" seria mentira.
 */
export function buildAbandonedLeadEmail(model: NotificationModel): EmailContent {
  const min = model.inactiveMinutes
  return renderLeadEmail(model, {
    subjectPrefix: 'Lead incompleto',
    heading: 'Lead incompleto ⚠️',
    headingColor: WARNING,
    lede:
      typeof min === 'number' && Number.isFinite(min) && min >= 0
        ? `Sem atividade há ${min} min — não finalizou.`
        : 'Começou a preencher e não finalizou.',
    timeLabel: 'Última atividade',
    answersTitle: 'O que já foi respondido',
  })
}

function renderLeadEmail(model: NotificationModel, v: LeadEmailVariant): EmailContent {
  const nome = model.identity.fullName?.trim() ?? ''
  const formTitle = model.form.title

  // O nome vem PRIMEIRO de propósito: se o cliente de e-mail truncar o
  // assunto, o que importa para triagem sobrevive.
  const subject = nome
    ? `${v.subjectPrefix}: ${sanitizeSingleLine(nome)} — ${sanitizeSingleLine(formTitle)}`
    : `${v.subjectPrefix} em ${sanitizeSingleLine(formTitle)}`

  const waDigits = toWhatsAppDigits(model.identity.phone)
  const quando = formatEventAt(model.response.eventAt)
  const origem = utmParts(model)
  const rows = visibleAnswers(model)
  const eventos = model.conversionEvents

  // ── HTML ────────────────────────────────────────────────────────────────
  const preheaderBits = [nome, model.identity.phone].filter(Boolean).map(h1line)
  const preheader = preheaderBits.length
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheaderBits.join(' · ')}</div>`
    : ''

  const identityRows = [
    nome ? ['Nome', nome] : null,
    model.identity.email ? ['E-mail', model.identity.email] : null,
    model.identity.phone ? ['Telefone', model.identity.phone] : null,
    quando ? [v.timeLabel, `${quando} (horário de Brasília)`] : null,
  ].filter((r): r is [string, string] => r !== null)

  const identityHtml = identityRows
    // NÃO usar `v` como nome aqui: sombrearia a variante do e-mail.
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">${h1line(label)}</td>` +
        `<td style="padding:4px 0;color:#111"><strong>${h1line(value)}</strong></td></tr>`
    )
    .join('')

  const answersHtml = rows.length
    ? `<h3 style="margin:24px 0 8px;font-size:15px;color:#111">${escapeHtml(v.answersTitle)}</h3>
       <table style="width:100%;border-collapse:collapse;font-size:14px">
         ${rows
           .map(
             (a) =>
               `<tr>
                  <td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee;color:#666;vertical-align:top;width:40%">${h1line(a.question)}</td>
                  <td style="padding:8px 0;border-bottom:1px solid #eee;color:#111;vertical-align:top">${hblock(a.value)}</td>
                </tr>`
           )
           .join('')}
       </table>`
    : ''

  // Self-hide: a maioria dos leads chega sem UTM e "Origem: —" em todo e-mail
  // é ruído. Espelha o comportamento do buildMessage do WhatsApp.
  const origemHtml = origem.length
    ? `<p style="margin:16px 0 0;font-size:13px;color:#666">Origem: ${origem.map(h1line).join(' · ')}</p>`
    : ''

  const eventosHtml = eventos.length
    ? `<div style="margin:16px 0 0;padding:12px;background:#f6f6fb;border-radius:8px">
         <p style="margin:0;font-size:13px;color:#333">${CONVERSION_LABEL}: <strong>${eventos.map(h1line).join(', ')}</strong></p>
         <p style="margin:6px 0 0;font-size:12px;color:#888;font-style:italic">${escapeHtml(CONVERSION_DISCLAIMER)}</p>
       </div>`
    : ''

  // Sem reply_to (decisão 1 do plano): no celular, tocar no botão abre o
  // WhatsApp direto. Some quando não há telefone válido.
  const waHtml = waDigits
    ? `<a href="https://wa.me/${waDigits}"
          style="display:inline-block;padding:12px 24px;background:${WHATSAPP_GREEN};color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">
         Responder no WhatsApp
       </a>`
    : ''

  const html = `
    ${preheader}
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
      <h2 style="color:${v.headingColor};margin:0 0 4px">${escapeHtml(v.heading)}</h2>
      <p style="margin:0 0 ${v.lede ? '8' : '16'}px;color:#666">em <strong>${h1line(formTitle)}</strong></p>
      ${v.lede ? `<p style="margin:0 0 16px;color:#111;font-weight:bold">${escapeHtml(v.lede)}</p>` : ''}
      <table style="border-collapse:collapse;font-size:14px">${identityHtml}</table>
      ${answersHtml}
      ${origemHtml}
      ${eventosHtml}
      <div style="margin-top:24px">
        ${waHtml}
        <a href="${escapeHtml(model.response.link)}"
           style="display:inline-block;padding:12px 24px;background:${BRAND};color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">
          Ver no painel
        </a>
      </div>
      <p style="color:#888;font-size:12px;margin-top:24px">EidosForm — Formulários inteligentes</p>
    </div>
  `.trim()

  // ── Texto puro ──────────────────────────────────────────────────────────
  const textLines: string[] = [
    nome ? `${v.subjectPrefix}: ${sanitizeSingleLine(nome)}` : v.subjectPrefix,
    `Formulário: ${sanitizeSingleLine(formTitle)}`,
  ]
  if (v.lede) textLines.push(v.lede)
  if (model.identity.email) textLines.push(`E-mail: ${sanitizeSingleLine(model.identity.email)}`)
  if (model.identity.phone) textLines.push(`Telefone: ${sanitizeSingleLine(model.identity.phone)}`)
  if (quando) textLines.push(`${v.timeLabel}: ${quando} (horário de Brasília)`)
  if (rows.length) {
    textLines.push('', v.answersTitle.toUpperCase())
    for (const a of rows) {
      textLines.push('', sanitizeSingleLine(a.question), sanitizeMultiLine(a.value))
    }
  }
  if (origem.length) textLines.push('', `Origem: ${origem.map(sanitizeSingleLine).join(' · ')}`)
  if (eventos.length) {
    textLines.push(
      '',
      `${CONVERSION_LABEL}: ${eventos.map(sanitizeSingleLine).join(', ')}`,
      CONVERSION_DISCLAIMER
    )
  }
  textLines.push('')
  if (waDigits) textLines.push(`Responder no WhatsApp: https://wa.me/${waDigits}`)
  textLines.push(`Ver no painel: ${model.response.link}`)
  textLines.push('', 'EidosForm — Formulários inteligentes')

  return { subject, html, text: textLines.join('\n') }
}
