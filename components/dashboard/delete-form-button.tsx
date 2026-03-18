'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface DeleteFormButtonProps {
  formId: string
  formTitle: string
}

export function DeleteFormButton({ formId, formTitle }: DeleteFormButtonProps) {
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleDelete = async () => {
    setIsDeleting(true)
    const { error } = await supabase
      .from('forms')
      .delete()
      .eq('id', formId)

    if (error) {
      toast.error('Falha ao excluir formulário')
      setIsDeleting(false)
    } else {
      toast.success('Formulário excluído com sucesso')
      setOpen(false)
      router.refresh()
    }
  }

  return (
    <>
      <DropdownMenuItem
        onClick={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
        className="cursor-pointer text-red-600 focus:text-red-600"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Excluir
      </DropdownMenuItem>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir formulário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir &quot;{formTitle || 'Formulário sem título'}&quot;? 
              Esta ação não pode ser desfeita. Todas as respostas também serão excluídas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Excluindo...' : 'Excluir formulário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

