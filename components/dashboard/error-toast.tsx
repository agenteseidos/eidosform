'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'

const errorMessages: Record<string, string> = {
  slug_collision:
    'Não foi possível gerar um link único para o formulário. Tente novamente.',
  create_failed:
    'Erro ao criar formulário. Tente novamente mais tarde.',
}

export function ErrorToast() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const error = searchParams.get('error')

  useEffect(() => {
    if (!error) return

    const message = errorMessages[error] || 'Ocorreu um erro inesperado.'

    if (error === 'slug_collision') {
      toast.error(message, {
        action: {
          label: 'Tentar novamente',
          onClick: () => router.push('/forms/new'),
        },
        duration: 8000,
      })
    } else {
      toast.error(message, { duration: 5000 })
    }

    // Clean URL params without full reload
    const url = new URL(window.location.href)
    url.searchParams.delete('error')
    url.searchParams.delete('retry')
    window.history.replaceState({}, '', url.pathname)
  }, [error, router])

  return null
}
