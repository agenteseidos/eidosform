import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consultarDividaPendente } from '@/lib/divida-pendente'
import { logWarn } from '@/lib/logger'

/**
 * GET /api/user/divida-pendente — alimenta o aviso de fatura vencida no painel.
 *
 * Endpoint SEPARADO do plan-features de propósito: este fala com o Asaas (rede, latência) e o
 * plan-features é carregado no caminho crítico da tela. Um gateway lento não pode atrasar o
 * painel inteiro por causa de um aviso.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('asaas_subscription_id, overdue_subscription_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ temDivida: false })

  try {
    const divida = await consultarDividaPendente(profile)
    // `ok:false` (não consegui perguntar) vira "sem aviso": melhor calar do que anunciar uma
    // dívida que talvez não exista. A guarda do checkout trata o mesmo caso ao contrário.
    if (!divida.ok || !divida.temDivida) return NextResponse.json({ temDivida: false })
    return NextResponse.json({
      temDivida: true,
      valor: divida.valor,
      vencimento: divida.vencimento,
      url: divida.url,
    })
  } catch (err) {
    logWarn('[divida-pendente] falhou — painel segue sem o aviso', { err: String(err).slice(0, 120) })
    return NextResponse.json({ temDivida: false })
  }
}
