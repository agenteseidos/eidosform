'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function ResponsesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ResponsesPage] Unhandled error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Erro ao carregar respostas</h2>
        <p className="text-slate-500 mb-6 text-sm">
          Ocorreu um erro inesperado ao carregar esta página. Tente novamente ou volte ao painel.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={reset}>
            Tentar novamente
          </Button>
          <Link href="/dashboard">
            <Button className="bg-blue-600 hover:bg-blue-700">Voltar ao painel</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
