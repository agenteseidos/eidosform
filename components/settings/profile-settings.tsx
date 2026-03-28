'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface ProfileSettingsProps {
  email: string
  fullName: string
  avatarUrl?: string
  initials: string
  memberSince: string
}

export function ProfileSettings({
  email,
  fullName: initialFullName,
  avatarUrl,
  initials,
  memberSince,
}: ProfileSettingsProps) {
  const [fullName, setFullName] = useState(initialFullName)
  const [isSaving, setIsSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async () => {
    const trimmed = fullName.trim()
    if (!trimmed) {
      toast.error('O nome não pode ficar vazio')
      return
    }

    setIsSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: trimmed },
      })

      if (error) {
        toast.error('Falha ao salvar. Tente novamente.')
        console.error('Profile update error:', error)
      } else {
        toast.success('Perfil atualizado com sucesso!')
      }
    } catch (err) {
      toast.error('Erro inesperado ao salvar.')
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <User className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900">Perfil</h2>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <Avatar className="h-16 w-16">
          <AvatarImage src={avatarUrl} alt={email} />
          <AvatarFallback className="bg-blue-600 text-white text-xl font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium text-slate-900">{fullName || email}</p>
          <p className="text-sm text-slate-500">{email}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Membro desde {memberSince}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Nome completo</Label>
          <Input
            id="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Seu nome"
            className="mt-1.5"
            disabled={isSaving}
          />
        </div>
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={email}
            disabled
            className="mt-1.5 bg-slate-50 text-slate-500"
          />
          <p className="text-xs text-slate-400 mt-1">O e-mail não pode ser alterado</p>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Salvando...
            </>
          ) : (
            'Salvar alterações'
          )}
        </Button>
      </div>
    </Card>
  )
}
