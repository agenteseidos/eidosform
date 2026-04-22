'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { toast } from 'sonner'

export function AccountActions({ planKey }: { planKey: string }) {
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
            <p className="text-xs text-slate-500">Você continuará no plano Free</p>
            <Link href="/billing">
              <span className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors min-h-[44px] px-2 inline-flex items-center cursor-pointer">
                Cancelar assinatura
              </span>
            </Link>
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
    </>
  )
}
