import { getLinkPagamentoVencido } from '@/lib/asaas'

/**
 * A DÍVIDA EM ABERTO DE UM CLIENTE — fonte única para o aviso no painel e para a guarda do
 * checkout (25/08/2026).
 *
 * ORIGEM: quem foi rebaixado por falta de pagamento é justamente quem mais tende a abrir o
 * painel e assinar de novo. Até hoje isso criava uma ASSINATURA NOVA com a antiga ainda viva —
 * duas ACTIVE ao mesmo tempo, risco de cobrança dobrada até o reconcile passar (~1h), e a
 * fatura vencida ficando órfã. O caminho estava aberto DE PROPÓSITO: o checkout trata plano
 * vencido como 'free' para destravar a recompra.
 *
 * A decisão do Sidney (25/08) foi: deixar comprar, mas MATANDO a assinatura velha antes — e
 * avisar da dívida no painel, para quem preferir só regularizar e voltar na hora.
 */
export type DividaPendente = {
  /** `true` só quando há CERTEZA de dívida. Falha de leitura devolve `false` + `ok: false`. */
  temDivida: boolean
  /** `false` = não consegui perguntar ao gateway. NUNCA tratar como "não deve". */
  ok: boolean
  subscriptionId: string | null
  valor: number | null
  vencimento: string | null
  url: string | null
}

const VAZIO: DividaPendente = {
  temDivida: false, ok: true, subscriptionId: null, valor: null, vencimento: null, url: null,
}

/**
 * A assinatura que carrega a dívida. Depois do rebaixamento o `expire-plans` MOVE a assinatura
 * de `asaas_subscription_id` para `overdue_subscription_id` — olhar só a primeira é o erro que
 * faz o sistema achar que não há dívida justamente no caso em que ela existe.
 */
export function assinaturaComDivida(p: {
  asaas_subscription_id?: string | null
  overdue_subscription_id?: string | null
}): string | null {
  return p?.overdue_subscription_id ?? p?.asaas_subscription_id ?? null
}

export async function consultarDividaPendente(p: {
  asaas_subscription_id?: string | null
  overdue_subscription_id?: string | null
}): Promise<DividaPendente> {
  const subId = assinaturaComDivida(p)
  if (!subId) return VAZIO

  const cobranca = await getLinkPagamentoVencido(subId)
  // Leitura falhou → NÃO SEI. Devolve ok:false para o chamador decidir: o painel omite o aviso
  // (melhor calar que mentir), a guarda do checkout DEIXA PASSAR (não perder venda por rede).
  if (!cobranca.ok) return { ...VAZIO, ok: false, subscriptionId: subId }
  if (!cobranca.dueDate) return { ...VAZIO, subscriptionId: subId }

  return {
    temDivida: true,
    ok: true,
    subscriptionId: subId,
    valor: cobranca.value,
    vencimento: cobranca.dueDate,
    // Pode ser null quando a fatura não tem página (o EidosForm não vende boleto — ver
    // getLinkPagamentoVencido). Aí o aviso aparece SEM botão, em vez de levar a lugar nenhum.
    url: cobranca.url,
  }
}
