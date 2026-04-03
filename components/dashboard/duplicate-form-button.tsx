'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { CopyPlus } from 'lucide-react'
import { toast } from 'sonner'

interface DuplicateFormButtonProps {
  formId: string
  mode?: 'menu' | 'icon'
  className?: string
}

export function DuplicateFormButton({ formId, mode = 'menu', className }: DuplicateFormButtonProps) {
  const [isDuplicating, setIsDuplicating] = useState(false)
  const router = useRouter()

  const handleDuplicate = async () => {
    if (isDuplicating) return

    setIsDuplicating(true)

    try {
      const response = await fetch(`/api/forms/${formId}/duplicate`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Falha ao duplicar formulário')
      }

      const { form } = await response.json()
      toast.success('Formulário duplicado com sucesso')
      router.refresh()
      router.push(`/forms/${form.id}/edit`)
    } catch {
      toast.error('Falha ao duplicar formulário')
    } finally {
      setIsDuplicating(false)
    }
  }

  if (mode === 'icon') {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleDuplicate}
        disabled={isDuplicating}
        className={className}
        title="Duplicar formulário"
        aria-label="Duplicar formulário"
      >
        <CopyPlus className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault()
        handleDuplicate()
      }}
      disabled={isDuplicating}
      className={className ?? 'cursor-pointer'}
    >
      <CopyPlus className="mr-2 h-4 w-4" />
      {isDuplicating ? 'Duplicando...' : 'Duplicar formulário'}
    </DropdownMenuItem>
  )
}
