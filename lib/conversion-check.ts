import { resolverPlanoAtual } from '@/lib/migracao/decisao'

export type AccountState = 'paid' | 'free' | 'none' | 'unknown'

export type ConversionProfile = {
  id: string
  plan: string | null
  plan_status: string | null
  plan_cycle: string | null
  plan_expires_at: string | null
}

function avaliarProfile(profile: ConversionProfile): Exclude<AccountState, 'none'> {
  const status = String(profile.plan_status ?? '').trim().toLowerCase()
  // Inadimplência, chargeback, cancelamento consumado e estado legado/desconhecido
  // são deliberadamente inconclusivos para um envio comercial proativo.
  if (status !== 'active' && status !== 'canceling') return 'unknown'

  const resolvido = resolverPlanoAtual(profile)
  if (resolvido.indeterminado || !resolvido.plano) return 'unknown'

  const persistido = String(profile.plan ?? '').trim().toLowerCase()
  // Um plano pago expirado que resolverPlanoAtual reduz a free não é uma conta free
  // limpa: existe histórico de cobrança que merece tratamento próprio.
  if (persistido !== 'free' && resolvido.plano === 'free') return 'unknown'
  if (resolvido.plano === 'free') return persistido === 'free' ? 'free' : 'unknown'
  return 'paid'
}

export function decidirEstadoConta(profiles: ConversionProfile[]): AccountState {
  if (!profiles.length) return 'none'
  // Telefone compartilhado nunca revela nem escolhe uma das contas.
  if (profiles.length !== 1) return 'unknown'
  return avaliarProfile(profiles[0])
}
