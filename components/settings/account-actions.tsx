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
import { Input } from '@/components/ui/input'

interface AccountActionsProps {
  planKey: string
  planExpiresAt?: string | null
  planStatus?: string | null
}

export function AccountActions({ planKey, planExpiresAt, planStatus: initialPlanStatus }: AccountActionsProps) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [cancelConfirmText, setCancelConfirmText] = useState('')
  const [cancelled, setCancelled] = useState(initialPlanStatus === 'canceling')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

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
      setCancelConfirmText('')
      setCancelled(true)
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
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao deletar conta')
        return
      }
      const supabase = createClient()
      await supabase.auth.signOut()
      window.location.href = '/'
    } catch {
      toast.error('Erro de rede ao deletar conta')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteDialogClose = (open: boolean) => {
    if (!open) {
      setDeleteStep(1)
      setDeleteConfirmText('')
    }
    setDeleteOpen(open)
  }

  const handleCancelDialogClose = (open: boolean) => {
    if (!open) setCancelConfirmText('')
    setCancelOpen(open)
  }

  return (
    <>
      {planKey !== 'free' && (
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between gap-4">
            {cancelled ? (
              <p className="text-xs text-slate-500">
                {expiresFormatted
                  ? `Assinatura cancelada — acesso até ${expiresFormatted}`
                  : 'Assinatura cancelada'}
              </p>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">Remove todos os dados permanentemente</p>
          <button
            onClick={() => setDeleteOpen(true)}
            className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors min-h-[44px] px-2 inline-flex items-center"
          >
            Deletar conta
          </button>
        </div>
      </div>

      {/* Cancel subscription dialog */}
      <Dialog open={cancelOpen} onOpenChange={handleCancelDialogClose}>
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
                <div className="pt-2">
                  <p className="mb-2 font-medium text-slate-700">
                    Para confirmar, digite <span className="font-mono bg-slate-100 px-1 rounded">CANCELAR</span>:
                  </p>
                  <Input
                    value={cancelConfirmText}
                    onChange={e => setCancelConfirmText(e.target.value)}
                    placeholder="CANCELAR"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
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
              disabled={canceling || cancelConfirmText !== 'CANCELAR'}
            >
              {canceling ? 'Cancelando...' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete account dialog */}
      <Dialog open={deleteOpen} onOpenChange={handleDeleteDialogClose}>
        <DialogContent className="max-w-md">
          {deleteStep === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-600">Deletar conta</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-3 text-sm text-slate-600">
                    <p>
                      Esta ação é <strong className="text-slate-800">permanente e irreversível</strong>. Serão deletados:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-slate-500">
                      <li>Todos os seus formulários e respostas</li>
                      <li>Configurações de domínio e API keys</li>
                      <li>Histórico de cobranças</li>
                      <li>Sua assinatura ativa (se houver)</li>
                    </ul>
                    <div className="pt-2">
                      <p className="mb-2 font-medium text-slate-700">
                        Digite <span className="font-mono bg-slate-100 px-1 rounded">DELETAR</span> para continuar:
                      </p>
                      <Input
                        value={deleteConfirmText}
                        onChange={e => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETAR"
                        className="font-mono"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <DialogClose asChild>
                  <Button variant="outline">Cancelar</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  disabled={deleteConfirmText !== 'DELETAR'}
                  onClick={() => setDeleteStep(2)}
                >
                  Continuar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-600">Tem certeza absoluta?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p>
                      Ao confirmar, sua conta e <strong className="text-slate-800">todos os seus dados</strong> serão
                      deletados imediatamente. Não há como desfazer esta ação.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  disabled={deleting}
                  onClick={() => setDeleteStep(1)}
                >
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                >
                  {deleting ? 'Deletando...' : 'Deletar conta definitivamente'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
