import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ArrowLeft, User, CreditCard, Trash2, LogOut } from 'lucide-react'
import Link from 'next/link'
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
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <User className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900">Perfil</h2>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <Avatar className="h-16 w-16">
            <AvatarImage src={avatarUrl} alt={user.email || 'User'} />
            <AvatarFallback className="bg-blue-600 text-white text-xl font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-slate-900">{fullName || user.email}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Membro desde {new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Nome completo</Label>
            <Input
              id="name"
              defaultValue={fullName}
              placeholder="Seu nome"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={user.email || ''}
              disabled
              className="mt-1.5 bg-slate-50 text-slate-500"
            />
            <p className="text-xs text-slate-400 mt-1">O e-mail não pode ser alterado</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700">
            Salvar alterações
          </Button>
        </div>
      </Card>

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

      {/* Zona de perigo */}
      <Card className="p-6 border-red-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Zona de perigo</h2>
        <p className="text-sm text-slate-500 mb-5">Ações irreversíveis — tenha cuidado</p>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
            <div>
              <p className="font-medium text-slate-900 text-sm">Cancelar assinatura</p>
              <p className="text-xs text-slate-500">Você continuará no plano Free</p>
            </div>
            <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50">
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Cancelar
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-100">
            <div>
              <p className="font-medium text-red-700 text-sm">Deletar conta</p>
              <p className="text-xs text-red-500">Apaga todos os seus formulários e respostas permanentemente</p>
            </div>
            <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-100 bg-white">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Deletar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
