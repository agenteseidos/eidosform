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
  /** Corpo do template de WhatsApp — mesma história, versão curta. Os {{n}} são as variáveis
   *  na ordem em que a Meta as recebe. */
  whatsappBody: string
  /** Nome do template a submeter à Meta. */
  whatsappTemplate: string
}

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
    whatsappTemplate: 'eidosform_cobranca_d0_v1',
    whatsappBody:
      'Olá, {{1}}! Hoje tentamos renovar sua assinatura do EidosForm ({{2}}) e o pagamento não foi aprovado — costuma ser limite do dia, cartão vencido ou instabilidade do banco.\n\n' +
      'Você tem 5 dias para regularizar. Seus formulários seguem funcionando normalmente. É só tocar no botão abaixo para pagar com cartão, Pix ou boleto.',
  },
  1: {
    assunto: 'Faltam 4 dias no seu plano {plano}',
    paragrafos: [
      'Olá, {nome}! Sua assinatura do EidosForm ({plano}) ainda está pendente. Faltam 4 dias para a conta voltar ao plano gratuito — onde ficam ' + LIMITES_FREE + '. Nada é apagado.',
      'Regularizar leva um minuto — cartão, Pix ou boleto:',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: 'eidosform_cobranca_d1_v1',
    whatsappBody:
      'Olá, {{1}}! Sua assinatura do EidosForm ({{2}}) ainda está pendente.\n\n' +
      'Faltam 4 dias para a conta voltar ao plano gratuito (3 formulários ativos e 100 respostas/mês). Nada é apagado. Regularizar leva um minuto:',
  },
  2: {
    assunto: 'Faltam 3 dias — depois seus formulários começam a pausar',
    paragrafos: [
      'Olá, {nome}! Faltam 3 dias para sua conta do EidosForm ({plano}) voltar ao plano gratuito: ' + LIMITES_FREE + '.',
      'Nada é apagado, mas os formulários acima do limite ficam pausados e param de receber respostas.',
      'Se o cartão tiver algum problema, dá pra pagar com outro pelo link:',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: 'eidosform_cobranca_d2_v1',
    whatsappBody:
      'Olá, {{1}}! Faltam 3 dias para sua conta do EidosForm ({{2}}) voltar ao plano gratuito.\n\n' +
      'Nada é apagado, mas os formulários acima de 3 ficam pausados e param de receber respostas. Se o cartão tiver problema, dá pra pagar com outro:',
  },
  3: {
    assunto: 'Em 2 dias você deixa de ser avisado dos seus leads',
    paragrafos: [
      'Olá, {nome}. Faltam 2 dias. Sem a confirmação do pagamento, sua conta do EidosForm ({plano}) volta ao gratuito — e aí as notificações e integrações param: você deixa de ser avisado na hora de cada novo lead, e eles param de cair na sua planilha e no seu CRM.',
      'Também ficam só 3 formulários ativos e 100 respostas/mês. Nada é apagado; tudo volta quando você regularizar.',
    ],
    ctaLabel: 'Regularizar meu pagamento',
    whatsappTemplate: 'eidosform_cobranca_d3_v1',
    whatsappBody:
      'Olá, {{1}}. Faltam 2 dias para sua conta do EidosForm ({{2}}) voltar ao gratuito.\n\n' +
      'Aí as notificações param: você deixa de ser avisado na hora de cada novo lead, e eles param de cair na sua planilha. Nada é apagado; tudo volta quando regularizar:',
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
    whatsappTemplate: 'eidosform_cobranca_d4_v1',
    whatsappBody:
      'Olá, {{1}}. O prazo termina amanhã.\n\n' +
      'Sem o pagamento, sua conta do EidosForm ({{2}}) volta ao gratuito: os formulários acima de 3 param de receber respostas e você deixa de ser avisado dos novos leads.\n\n' +
      'Nada é apagado — tudo volta assim que você regularizar:',
  },
  5: {
    assunto: 'Seus formulários foram pausados — reative quando quiser',
    paragrafos: [
      'Olá, {nome}. Como o pagamento não foi confirmado no prazo, sua conta do EidosForm voltou ao plano gratuito. Na prática: formulários acima de 3 estão pausados, você não recebe mais notificação de novos leads, as integrações estão desativadas e a marca EidosForm voltou aos formulários.',
      'Nenhum dado foi perdido — todas as respostas, formulários e configurações continuam guardados. Para voltar ao {plano} e reativar tudo na hora:',
    ],
    ctaLabel: 'Reativar minha assinatura',
    whatsappTemplate: 'eidosform_cobranca_d5_v1',
    whatsappBody:
      'Olá, {{1}}. Como o pagamento não foi confirmado no prazo, sua conta do EidosForm voltou ao plano gratuito.\n\n' +
      'Os formulários acima de 3 estão pausados e as notificações desativadas. Nenhum dado foi perdido. Para voltar ao {{2}} e reativar tudo na hora:',
  },
}

/** Troca {nome} e {plano} — o mesmo par nos dois canais. */
export function preencher(texto: string, dados: { nome: string; plano: string }): string {
  return texto.replace(/\{nome\}/g, dados.nome).replace(/\{plano\}/g, dados.plano)
}
