'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CopyPlus } from 'lucide-react'
import { toast } from 'sonner'

interface DuplicateFormButtonProps {
  formId: string
}

export function DuplicateFormButton({ formId }: DuplicateFormButtonProps) {
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

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault()
        handleDuplicate()
      }}
      disabled={isDuplicating}
      className="cursor-pointer"
    >
      <CopyPlus className="mr-2 h-4 w-4" />
      {isDuplicating ? 'Duplicando...' : 'Duplicar formulário'}
    </DropdownMenuItem>
  )
}
