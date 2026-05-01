'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface AccountActionsProps {
  planKey: string
  planExpiresAt?: string | null
}

export function AccountActions({ planKey, planExpiresAt }: AccountActionsProps) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [canceling, setCanceling] = useState(false)

  const expiresFormatted = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const handleConfirmCancel = async () => {
    setCanceling(true)
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao cancelar assinatura')
        return
      }
      setCancelOpen(false)
      const expires = data.expiresAt
        ? new Date(data.expiresAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
        : null
      toast.success(
        expires
          ? `Assinatura cancelada. Você mantém o acesso até ${expires}.`
          : 'Assinatura cancelada com sucesso.'
      )
    } catch {
      toast.error('Erro de rede ao cancelar assinatura')
    } finally {
      setCanceling(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita. Todos os seus formulários, respostas e dados serão excluídos permanentemente.')) return
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error('Erro ao sair da conta')
    } else {
      window.location.href = '/login'
    }
  }

  return (
    <>
      {planKey !== 'free' && (
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              {expiresFormatted
                ? `Você continuará no plano Free após ${expiresFormatted}`
                : 'Você continuará no plano Free'}
            </p>
            <button
              onClick={() => setCancelOpen(true)}
              className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors min-h-[44px] px-2 inline-flex items-center cursor-pointer"
            >
              Cancelar assinatura
            </button>
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">Remove todos os dados permanentemente</p>
          <button
            onClick={handleDeleteAccount}
            className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors min-h-[44px] px-2 inline-flex items-center"
          >
            Deletar conta
          </button>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar assinatura</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600">
                <p>
                  Tem certeza que deseja cancelar sua assinatura?
                </p>
                {expiresFormatted ? (
                  <p>
                    Você manterá acesso a todos os recursos do plano atual até{' '}
                    <strong className="text-slate-800">{expiresFormatted}</strong>. Após essa data, sua conta será
                    movida automaticamente para o plano Free.
                  </p>
                ) : (
                  <p>
                    Após o cancelamento, sua conta será movida para o plano Free ao fim do período atual.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline" disabled={canceling}>
                Manter assinatura
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={canceling}
            >
              {canceling ? 'Cancelando...' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
