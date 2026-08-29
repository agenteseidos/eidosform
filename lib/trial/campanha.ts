/**
 * Leitura da campanha de trial para a PÁGINA de cadastro.
 *
 * Isto é a porta, não a fechadura. Quem decide de verdade quem entra é a RPC
 * `reserve_trial_signup`, que revalida campanha, prazo, lista e uso anterior no momento do
 * cadastro. Se esta função errasse para mais, o cadastro ainda seria recusado lá; ela existe
 * para não mostrar um formulário que nunca funcionaria.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export type CampanhaTrial = {
  nome: string
  duration_days: number
}

export async function buscarCampanhaValida(codigo: string): Promise<CampanhaTrial | null> {
  if (!codigo || codigo.length > 64) return null

  const admin = createAdminClient()
  // Só o código VIGENTE: `codigo_anterior` existe para que rotacionar um código vazado
  // invalide o antigo na hora, então ele não entra aqui.
  const { data } = await admin
    .from('trial_campaigns')
    .select('nome, duration_days, valido_ate, ativa')
    .eq('codigo', codigo)
    .maybeSingle()

  if (!data?.ativa) return null
  if (new Date(data.valido_ate).getTime() <= Date.now()) return null

  return { nome: data.nome, duration_days: data.duration_days }
}
