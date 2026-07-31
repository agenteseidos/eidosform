import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildLeadData } from './integration-stubs'
import { buildMessage, DEFAULT_WHATSAPP_MESSAGE_TEMPLATE, ABANDONED_LEAD_TEMPLATE } from './whatsapp-template'

/**
 * REDE DE SEGURANÇA DO REFACTOR (Entrega 1, item 4.7.1 do plano
 * docs/plano-notificacao-email.md).
 *
 * A mensagem de WhatsApp gerada pelo par buildLeadData + buildMessage tem que
 * continuar BYTE A BYTE igual à de antes da extração do modelo neutro. Os
 * "golden strings" abaixo foram capturados rodando o código de `main` (2c814ec)
 * ANTES de qualquer alteração. Se um deles mudar, o refactor alterou a única
 * notificação que hoje funciona em produção — pare e investigue.
 *
 * O relógio é congelado porque {data}/{horario} do WhatsApp são calculados no
 * momento do ENVIO (comportamento preservado de propósito — ver relatório).
 */

const FIXED_NOW = new Date('2026-07-30T17:32:10.000Z') // 14:32 em São Paulo

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})
afterAll(() => {
  vi.useRealTimers()
})

const fullForm = {
  id: 'form-1',
  title: 'Psicoterapia — Primeira Consulta',
  user_id: 'user-1',
  questions: [
    { id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' },
    { id: 'q_email', type: 'email', title: 'Seu melhor e-mail' },
    { id: 'q_tel', type: 'phone', title: 'Seu WhatsApp' },
    { id: 'q_multi', type: 'multiple_choice', title: 'O que te trouxe aqui?' },
    { id: 'q_arquivo', type: 'file_upload', title: 'Envie um documento' },
    { id: 'q_end', type: 'address', title: 'Endereço' },
    { id: 'q_agenda', type: 'calendly', title: 'Escolha um horário' },
    { id: 'q_bloco', type: 'html_block', title: 'Bloco decorativo' },
    { id: 'q_vazia', type: 'long_text', title: 'Algo mais?' },
  ],
}

const fullResponseData: Record<string, unknown> = {
  q_nome: 'maria fernanda souza',
  q_email: 'maria@exemplo.com',
  q_tel: '83999998888',
  q_multi: ['Ansiedade', 'Relacionamento'],
  q_arquivo: { name: 'exame.pdf', url: 'https://cdn.exemplo.com/exame.pdf', size: 1234, type: 'application/pdf' },
  q_end: { cep: '58000-000', rua: 'Rua das Flores', numero: '120', bairro: 'Centro', cidade: 'João Pessoa', estado: 'PB' },
  q_agenda: { event_uri: 'https://api.calendly.com/scheduled_events/abc' },
  q_bloco: 'nao deve aparecer',
  q_vazia: '',
  q_orfa: 'resposta sem pergunta correspondente',
}

function leadCompleto() {
  return buildLeadData({
    formId: 'form-1',
    responseId: 'resp-1',
    responseData: fullResponseData,
    meta_events: ['Lead', 'LeadQualificado'],
    urlParams: { origem: 'ads' },
    utm: { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'julho', utm_term: null, utm_content: 'criativo-a' },
    form: fullForm,
    appUrl: 'https://eidosform.com.br',
  })
}

function leadSemTelefoneSemEventos() {
  return buildLeadData({
    formId: 'form-2',
    responseId: 'resp-2',
    responseData: { q_nome: 'joão', q_obs: 'sem telefone aqui' },
    meta_events: [],
    urlParams: null,
    utm: null,
    form: {
      id: 'form-2',
      title: 'Lista de espera',
      user_id: 'user-1',
      questions: [
        { id: 'q_nome', type: 'short_text', title: 'Nome' },
        { id: 'q_obs', type: 'long_text', title: 'Observação' },
      ],
    },
    appUrl: 'https://eidosform.com.br',
  })
}

describe('REGRESSÃO — mensagem de WhatsApp inalterada pelo refactor', () => {
  it('caso completo (telefone, eventos, arquivo, endereço, agendamento, UTM)', () => {
    const msg = buildMessage(DEFAULT_WHATSAPP_MESSAGE_TEMPLATE, leadCompleto())
    expect(msg).toMatchInlineSnapshot(`
      "🔔 *Novo lead* em *Psicoterapia — Primeira Consulta*

      *Qual seu nome?*
      maria fernanda souza

      *Seu melhor e-mail*
      maria@exemplo.com

      *Seu WhatsApp*
      83999998888

      *O que te trouxe aqui?*
      Ansiedade, Relacionamento

      *Envie um documento*
      📎 exame.pdf
      https://cdn.exemplo.com/exame.pdf

      *Endereço*
      Rua das Flores, 120, Centro, João Pessoa/PB, CEP 58000-000

      *Escolha um horário*
      ✅ Agendamento realizado

      💬 Responder: https://wa.me/5583999998888
      🕒 Recebido 30/07/2026 às 14:32
      *Eventos Meta:* Lead, LeadQualificado"
    `)
  })

  it('caso sem telefone e sem eventos (linhas somem por self-hide)', () => {
    const msg = buildMessage(DEFAULT_WHATSAPP_MESSAGE_TEMPLATE, leadSemTelefoneSemEventos())
    expect(msg).toMatchInlineSnapshot(`
      "🔔 *Novo lead* em *Lista de espera*

      *Nome*
      joão

      *Observação*
      sem telefone aqui

      🕒 Recebido 30/07/2026 às 14:32"
    `)
  })

  it('alerta de lead abandonado (template do cron) continua igual', () => {
    const lead = { ...leadCompleto(), abandono_minutos: '45' }
    const msg = buildMessage(ABANDONED_LEAD_TEMPLATE, lead)
    expect(msg).toMatchInlineSnapshot(`
      "⚠️ *Lead incompleto* em *Psicoterapia — Primeira Consulta*
      Sem atividade há 45 min — não finalizou.

      *Qual seu nome?*
      maria fernanda souza

      *Seu melhor e-mail*
      maria@exemplo.com

      *Seu WhatsApp*
      83999998888

      *O que te trouxe aqui?*
      Ansiedade, Relacionamento

      *Envie um documento*
      📎 exame.pdf
      https://cdn.exemplo.com/exame.pdf

      *Endereço*
      Rua das Flores, 120, Centro, João Pessoa/PB, CEP 58000-000

      *Escolha um horário*
      ✅ Agendamento realizado

      💬 Responder: https://wa.me/5583999998888
      *Eventos Meta:* Lead, LeadQualificado"
    `)
  })

  it('leadData completo — todas as chaves e valores do template', () => {
    expect(leadCompleto()).toMatchInlineSnapshot(`
      {
        "algo mais?": "",
        "bloco decorativo": "nao deve aparecer",
        "celular": "83999998888",
        "data": "30/07/2026",
        "dia_semana": "quinta-feira",
        "email": "maria@exemplo.com",
        "endereço": "Rua das Flores, 120, Centro, João Pessoa/PB, CEP 58000-000",
        "envie um documento": "📎 exame.pdf
      https://cdn.exemplo.com/exame.pdf",
        "escolha um horário": "✅ Agendamento realizado",
        "form_name": "Psicoterapia — Primeira Consulta",
        "horario": "14:32",
        "meta_events": "Lead, LeadQualificado",
        "name": "Maria",
        "nome": "Maria",
        "nome_completo": "Maria Fernanda Souza",
        "o que te trouxe aqui?": "Ansiedade, Relacionamento",
        "phone": "83999998888",
        "primeiro_nome": "Maria",
        "q_orfa": "resposta sem pergunta correspondente",
        "qual seu nome?": "maria fernanda souza",
        "response_id": "resp-1",
        "response_link": "https://eidosform.com.br/forms/form-1/responses?response=resp-1",
        "respostas": "*Qual seu nome?*
      maria fernanda souza

      *Seu melhor e-mail*
      maria@exemplo.com

      *Seu WhatsApp*
      83999998888

      *O que te trouxe aqui?*
      Ansiedade, Relacionamento

      *Envie um documento*
      📎 exame.pdf
      https://cdn.exemplo.com/exame.pdf

      *Endereço*
      Rua das Flores, 120, Centro, João Pessoa/PB, CEP 58000-000

      *Escolha um horário*
      ✅ Agendamento realizado",
        "seu melhor e-mail": "maria@exemplo.com",
        "seu whatsapp": "83999998888",
        "telefone": "83999998888",
        "utm_campaign": "julho",
        "utm_content": "criativo-a",
        "utm_medium": "cpc",
        "utm_source": "facebook",
        "utm_term": "",
        "whatsapp": "83999998888",
      }
    `)
  })
})
