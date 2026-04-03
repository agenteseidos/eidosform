'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export function PasswordSettings() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!newPassword || !confirmPassword) {
      toast.error('Preencha todos os campos')
      return
    }
    if (newPassword.length < 8) {
      toast.error('A senha deve ter no mínimo 8 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setIsLoading(false)

    if (error) {
      toast.error('Falha ao alterar senha. Tente novamente.')
    } else {
      toast.success('Senha alterada com sucesso!')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <KeyRound className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900">Alterar Senha</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="newPassword">Nova senha</Label>
          <div className="relative mt-1.5">
            <Input
              id="newPassword"
              type={showNew ? 'text' : 'password'}
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors h-11 w-11 flex items-center justify-center"
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
          <div className="relative mt-1.5">
            <Input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Repita a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors h-11 w-11 flex items-center justify-center"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? 'Salvando...' : 'Alterar senha'}
          </Button>
          <Link
            href="/forgot-password"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Esqueci minha senha
          </Link>
        </div>
      </form>
    </Card>
  )
}
