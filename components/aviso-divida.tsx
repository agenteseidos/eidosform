'use client'

import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'

type Divida = { temDivida: boolean; valor?: number | null; vencimento?: string | null; url?: string | null }

/**
 * AVISO DE FATURA VENCIDA — no topo da tela de planos (25/08/2026).
 *
 * Por que existe: quem foi rebaixado por falta de pagamento é justamente quem mais tende a abrir
 * esta tela e assinar de novo, criando uma cobrança nova com a dívida antiga ainda aberta. A
 * régua de cobrança oferece "Regularizar pagamento" por e-mail e WhatsApp, mas ela PARA no 5º
 * dia — quem volta meses depois não tem mais link nenhum. Este aviso é esse link, no lugar onde
 * a pessoa efetivamente vai.
 *
 * Ele NÃO bloqueia: os planos seguem logo abaixo. Quem clica aqui regulariza e volta ao plano na
 * hora; quem prefere assinar outro plano segue em frente, e a assinatura antiga (com a fatura
 * vencida junto) é cancelada na ativação.
 *
 * Busca à parte do resto da tela de propósito: fala com o gateway, e um Asaas lento não pode
 * atrasar o painel por causa de um aviso. Falhou? Não aparece — melhor calar que mentir.
 */
export function AvisoDivida() {
  const [d, setD] = useState<Divida | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/user/divida-pendente')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j?.temDivida) setD(j) })
      .catch(() => { /* silêncio proposital */ })
    return () => { vivo = false }
  }, [])

  if (!d?.temDivida) return null

  const valor = typeof d.valor === 'number'
    ? d.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null
  // Data vem como YYYY-MM-DD (dia BRT, já resolvido no servidor). Formatar sem `new Date` cru:
  // `new Date('2026-08-20')` é interpretado como UTC e volta um dia no fuso brasileiro.
  const venc = d.vencimento?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const vencBR = venc ? `${venc[3]}/${venc[2]}/${venc[1]}` : d.vencimento

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900">
            Você tem uma fatura em aberto{valor ? ` de ${valor}` : ''}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {vencBR ? <>Venceu em <strong>{vencBR}</strong>. </> : null}
            Pagar esta fatura reativa seu plano na hora — não é preciso assinar de novo.
          </p>
          {d.url ? (
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700"
            >
              Pagar e reativar meu plano
            </a>
          ) : (
            // Fatura sem página de pagamento (o EidosForm não vende boleto — ver
            // getLinkPagamentoVencido). Avisa mesmo assim, mas não manda a lugar nenhum.
            <p className="mt-2 text-sm text-amber-800">
              Fale com a gente pelo WhatsApp para regularizar.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
