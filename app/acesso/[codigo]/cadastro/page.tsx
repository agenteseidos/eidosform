/**
 * Cadastro em campanha de trial — /acesso/<codigo>/cadastro
 *
 * Página própria, fora do fluxo normal: só quem tem o link chega aqui, e só quem está na lista
 * da campanha recebe o plano. Um código inválido, desativado ou vencido devolve 404 igual a
 * qualquer página inexistente — nunca "esse convite expirou", que confirmaria que o código
 * existiu e convidaria a tentar variações.
 *
 * Não indexável e sem link em lugar nenhum do site: o endereço é o segredo mais fraco do
 * conjunto (a lista de telefones é o que realmente segura), mas não custa nada preservá-lo.
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { buscarCampanhaValida } from '@/lib/trial/campanha'
import { TrialSignupForm } from './trial-signup-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ativar acesso · EidosForm',
  robots: { index: false, follow: false, nocache: true },
}

export default async function CadastroTrialPage({
  params,
}: {
  params: Promise<{ codigo: string }>
}) {
  const { codigo } = await params

  const campanha = await buscarCampanhaValida(codigo)
  if (!campanha) notFound()

  return <TrialSignupForm codigo={codigo} dias={campanha.duration_days} />
}
