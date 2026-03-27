import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { ProfileSettings } from '@/components/settings/profile-settings'
import { DomainSettings } from '@/components/settings/domain-settings'
import { ApiKeySettings } from '@/components/settings/api-key-settings'
import { PasswordSettings } from '@/components/settings/password-settings'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch real plan from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const initials = user.email?.slice(0, 2).toUpperCase() || 'U'
  const avatarUrl = user.user_metadata?.avatar_url
  const fullName = user.user_metadata?.full_name || ''
  const planKey = (profile?.plan ?? 'free') as string
  const currentPlan = planKey.charAt(0).toUpperCase() + planKey.slice(1)
  const isProfessional = planKey === 'professional' || planKey === 'enterprise'

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
          <p className="text-slate-600 mt-1">Gerencie sua conta e preferências</p>
        </div>
      </div>

      {/* Perfil */}
      <ProfileSettings
        email={user.email || ''}
        fullName={fullName}
        avatarUrl={avatarUrl}
        initials={initials}
        memberSince={new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
      />

      {/* Alterar Senha */}
      <PasswordSettings />

      {/* Plano atual */}
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900">Assinatura</h2>
        </div>

        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-4">
          <div>
            <p className="font-semibold text-slate-900">Plano {currentPlan}</p>
            <p className="text-sm text-slate-500">{planKey === 'free' ? 'Gratuito para sempre' : `R$ ${planKey === 'starter' ? '49' : planKey === 'plus' ? '127' : '257'}/mês`}</p>
          </div>
          <Badge className="bg-slate-100 text-slate-700">🌱 {currentPlan}</Badge>
        </div>

        <div className="flex gap-3">
          <Link href="/billing">
            <Button className="bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-500/20">
              ✨ Ver planos e fazer upgrade
            </Button>
          </Link>
        </div>
      </Card>

      {/* Domínio personalizado */}
      <DomainSettings isProfessional={isProfessional} />

      {/* API Key */}
      <ApiKeySettings isProfessional={isProfessional} />

      {/* Ações da conta */}
      <div className="pt-4 border-t border-slate-100">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Cancelar assinatura</p>
              <p className="text-xs text-slate-300">Você continuará no plano Free</p>
            </div>
            <button className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
              Cancelar assinatura
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Deletar conta</p>
              <p className="text-xs text-slate-300">Remove todos os dados permanentemente</p>
            </div>
            <button className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors">
              Deletar conta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
