/**
 * Régua de cobrança — os TEXTOS dos 6 estágios (D-01, aprovados pelo Sidney em 11/08/2026).
 *
 * E-mail e WhatsApp moram no MESMO arquivo de propósito: os dois canais contam a mesma história
 * e precisam mudar juntos. Texto duplicado em dois lugares vira texto divergente em duas semanas.
 *
 * ⚠️ REGRAS DE REDAÇÃO QUE NÃO SE NEGOCIAM (decisões do Sidney):
 *  · NUNCA citar a plataforma de cobrança pelo nome. O cliente comprou do Instituto Eidos, não
 *    do gateway — ler um nome estranho no e-mail gera desconfiança, não clareza.
 *  · O problema é sempre O PAGAMENTO, nunca a pessoa: "não foi aprovado", jamais "você não pagou".
 *  · "Nada é apagado" em todo estágio que menciona a queda. A maior barreira para voltar é achar
 *    que perdeu o trabalho — quem acha que perdeu, não reassina.
 *  · Sem "deixar de existir": os formulários PAUSAM. Exagerar aqui compra desconfiança e perde
 *    o cliente de vez.
 *  · Gatilho de perda só a partir do D+3, e sempre CONCRETO (deixa de ser avisado dos leads;
 *    formulários param de receber). Assustar no dia 1 é apelação; perda vaga é ruído.
 */

export type EstagioTexto = {
  assunto: string
  /** Parágrafos do e-mail. Renderizados com UMA linha em branco entre eles (pedido do Sidney:
   *  "gosto de textos com espaçamento de uma linha entre parágrafos"). */
  paragrafos: string[]
  ctaLabel: string
  /**
   * A MENSAGEM DO DIA no WhatsApp — vai inteira no {{3}} do BODY (técnica {UP}, adotada como
   * padrão em 24/07 e aplicada aqui em 14/08). Os dois esqueletos submetidos à Meta são
   * neutros de propósito: saudação + este parâmetro + fecho fixo. Assim as 6 mensagens são
   * de fato diferentes (pedido do Sidney: "quero mensagens alinhadas aos e-mails") sem
   * precisar de 6 aprovações, e mudar uma frase não exige novo ciclo com a Meta.
   *
   * ⚠️ UMA LINHA CORRIDA, sempre: parâmetro da Cloud API NÃO aceita quebra de linha. É por isso
   * que a lista de 4 itens do e-mail do D+4 aqui vira uma frase só.
   */
  whatsappStageText: string
  /** Um dos dois templates UTILITY canônicos mantidos no repositório da Elen. */
  whatsappTemplate: string
}

export const DUNNING_WHATSAPP_TEMPLATES = {
  cobranca: 'eidosform_cobranca_v1',
  // v1 flipou p/ MARKETING ainda em análise (14/08). Suspeito: o botão 'Reativar assinatura'
  // — win-back lê como promocional. A v2 usa o MESMO botão do de cobrança, que segurou UTILITY.
  // O nome v1 fica bloqueado 30 dias; não reaproveitar.
  planoRebaixado: 'eidosform_plano_rebaixado_v2',
} as const

/** Bloco curto do que muda no gratuito — repetido para o cliente não precisar caçar a informação. */
const LIMITES_FREE = 'só 3 formulários ativos, 100 respostas/mês e sem pixel, integrações ou notificações'

/**
 * {nome} e {plano} são trocados no envio. No WhatsApp viram {{1}}, {{2}}… na ordem de aparição.
 */
export const TEXTOS_DUNNING: Record<0 | 1 | 2 | 3 | 4 | 5, EstagioTexto> = {
  0: {
    assunto: 'Seu pagamento de hoje não foi aprovado',
    paragrafos: [
      'Olá, {nome}! Hoje tentamos renovar sua assinatura do EidosForm ({plano}) e o pagamento não foi aprovado — costuma ser algo simples: limite do dia, cartão vencido ou instabilidade do banco.',
      `Você tem 5 dias para regularizar. Passado o prazo, sua conta volta ao plano gratuito: ${LIMITES_FREE}. Nada é apagado.`,
      'Seus formulários seguem funcionando normalmente enquanto isso.',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.cobranca,
    whatsappStageText:
      'O pagamento de hoje não foi aprovado — costuma ser algo simples: limite do dia, cartão vencido ou instabilidade do banco. Você tem 5 dias para regularizar, e seus formulários seguem funcionando normalmente enquanto isso.',
  },
  1: {
    assunto: 'Faltam 4 dias no seu plano {plano}',
    paragrafos: [
      'Olá, {nome}! Sua assinatura do EidosForm ({plano}) ainda está pendente. Faltam 4 dias para a conta voltar ao plano gratuito — onde ficam ' + LIMITES_FREE + '. Nada é apagado.',
      'Regularizar leva um minuto — cartão, Pix ou boleto:',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.cobranca,
    whatsappStageText:
      'O pagamento segue pendente. Faltam 4 dias para a conta voltar ao plano gratuito, onde ficam só 3 formulários ativos, 100 respostas por mês e sem notificações ou integrações. Regularizar leva um minuto — cartão, Pix ou boleto.',
  },
  2: {
    assunto: 'Faltam 3 dias — depois seus formulários começam a pausar',
    paragrafos: [
      'Olá, {nome}! Faltam 3 dias para sua conta do EidosForm ({plano}) voltar ao plano gratuito: ' + LIMITES_FREE + '.',
      'Nada é apagado, mas os formulários acima do limite ficam pausados e param de receber respostas.',
      'Se o cartão tiver algum problema, dá pra pagar com outro pelo link:',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.cobranca,
    whatsappStageText:
      'Faltam 3 dias para a conta voltar ao plano gratuito. A partir daí, os formulários acima do limite ficam pausados e param de receber respostas. Se o cartão tiver algum problema, dá para pagar com outro pelo link.',
  },
  3: {
    assunto: 'Em 2 dias você deixa de ser avisado dos seus leads',
    paragrafos: [
      'Olá, {nome}. Faltam 2 dias. Sem a confirmação do pagamento, sua conta do EidosForm ({plano}) volta ao gratuito — e aí as notificações e integrações param: você deixa de ser avisado na hora de cada novo lead, e eles param de cair na sua planilha e no seu CRM.',
      'Também ficam só 3 formulários ativos e 100 respostas/mês. Nada é apagado; tudo volta quando você regularizar.',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.cobranca,
    whatsappStageText:
      'Faltam 2 dias. Sem a confirmação do pagamento, a conta volta ao gratuito e as notificações param: você deixa de ser avisado na hora de cada novo lead, e eles param de cair na sua planilha e no seu CRM. Também ficam só 3 formulários ativos e 100 respostas por mês.',
  },
  4: {
    assunto: 'Amanhã seus formulários param de receber respostas',
    paragrafos: [
      'Olá, {nome}. O prazo termina amanhã. Sem o pagamento, sua conta do EidosForm ({plano}) volta ao plano gratuito e passa a valer:',
      '• Apenas 3 formulários ativos — os demais ficam pausados e param de receber respostas',
      '• 100 respostas por mês no total',
      '• Sem notificações de novos leads, sem integrações (webhook, planilha) e a marca EidosForm volta a aparecer',
      'Nada é apagado — tudo volta como está assim que você regularizar.',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.cobranca,
    whatsappStageText:
      'O prazo termina amanhã. Sem o pagamento, a conta volta ao plano gratuito: apenas 3 formulários ativos (os demais ficam pausados e param de receber respostas), 100 respostas por mês, sem notificações de novos leads e sem integrações.',
  },
  5: {
    assunto: 'Seus formulários foram pausados — reative quando quiser',
    paragrafos: [
      'Olá, {nome}. Como o pagamento não foi confirmado no prazo, sua conta do EidosForm voltou ao plano gratuito. Na prática: formulários acima de 3 estão pausados, você não recebe mais notificação de novos leads, as integrações estão desativadas e a marca EidosForm voltou aos formulários.',
      'Nenhum dado foi perdido — todas as respostas, formulários e configurações continuam guardados. Para voltar ao {plano} e reativar tudo na hora:',
    ],
    ctaLabel: 'Reativar minha assinatura',
    whatsappTemplate: DUNNING_WHATSAPP_TEMPLATES.planoRebaixado,
    whatsappStageText:
      'Como o pagamento não foi confirmado no prazo, a conta voltou ao plano gratuito: formulários acima de 3 pausados, sem notificação de novos leads e integrações desativadas.',
  },
}

/** Troca {nome} e {plano} — o mesmo par nos dois canais. */
export function preencher(texto: string, dados: { nome: string; plano: string }): string {
  return texto.replace(/\{nome\}/g, dados.nome).replace(/\{plano\}/g, dados.plano)
}
