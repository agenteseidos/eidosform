'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  MoreVertical, 
  ExternalLink,
  BarChart3,
  Pencil,
  Copy,
  FilePlus2,
  Trash2,
  Type
} from 'lucide-react'
import { Form, FormStatus } from '@/lib/database.types'
import { DeleteFormButton } from './delete-form-button'
import { useState } from 'react'
import { toast } from 'sonner'

interface FormCardProps {
  form: Form
  responseCount: number
}

function getStatusBadge(status: FormStatus) {
  switch (status) {
    case 'published':
      return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Publicado</Badge>
    case 'draft':
      return <Badge variant="secondary" className="bg-slate-100 text-slate-600">Rascunho</Badge>
    case 'closed':
      return <Badge variant="secondary" className="bg-amber-100 text-amber-700">Encerrado</Badge>
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function getStatusColor(status: FormStatus) {
  switch (status) {
    case 'published':
      return 'from-emerald-400 to-teal-500'
    case 'draft':
      return 'from-slate-300 to-slate-400'
    case 'closed':
      return 'from-amber-400 to-orange-500'
  }
}

export function FormCard({ form, responseCount }: FormCardProps) {
  const router = useRouter()
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(form.title || '')

  const copyFormLink = () => {
    const link = `${window.location.origin}/f/${form.slug}`
    navigator.clipboard.writeText(link)
    toast.success('Link copiado!')
  }

  const duplicateForm = async () => {
    try {
      const res = await fetch(`/api/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${form.title || 'Formulário'} (cópia)`,
          questions: [],
          status: 'draft',
        }),
      })
      if (!res.ok) throw new Error('Falha ao duplicar')
      toast.success('Formulário duplicado!')
      router.refresh()
    } catch {
      toast.error('Erro ao duplicar formulário')
    }
  }

  const renameForm = async () => {
    if (!renameValue.trim()) return
    try {
      const res = await fetch(`/api/forms/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      })
      if (!res.ok) throw new Error('Falha ao renomear')
      toast.success('Formulário renomeado!')
      setIsRenaming(false)
      router.refresh()
    } catch {
      toast.error('Erro ao renomear formulário')
    }
  }

  return (
    <>
    <Card className="overflow-hidden hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300 hover:-translate-y-0.5 bg-white/80 backdrop-blur-sm border-slate-200/60">
      {/* Color accent bar */}
      <div className={`h-1 bg-gradient-to-r ${getStatusColor(form.status)}`} />
      <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <Link 
            href={`/forms/${form.id}/edit`}
            className="text-lg font-semibold text-slate-900 hover:text-blue-600 truncate block transition-colors"
          >
            {form.title || 'Formulário sem título'}
          </Link>
          <p className="text-sm text-slate-500 mt-1">
            Atualizado em {formatDate(form.updated_at)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-11 w-11 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}/edit`} className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Link>
            </DropdownMenuItem>
            {form.status === 'published' && (
              <DropdownMenuItem asChild>
                <Link href={`/f/${form.slug}`} target="_blank" className="cursor-pointer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Ver formulário
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}/responses`} className="cursor-pointer">
                <BarChart3 className="mr-2 h-4 w-4" />
                Respostas
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={copyFormLink}
              className="cursor-pointer"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar link
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={duplicateForm}
              className="cursor-pointer"
            >
              <FilePlus2 className="mr-2 h-4 w-4" />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { setRenameValue(form.title || ''); setIsRenaming(true) }}
              className="cursor-pointer"
            >
              <Type className="mr-2 h-4 w-4" />
              Renomear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DeleteFormButton formId={form.id} formTitle={form.title} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between">
        {getStatusBadge(form.status)}
        <div className="flex items-center gap-1 text-sm text-slate-500">
          <BarChart3 className="w-4 h-4" />
          <span>{responseCount} respostas</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
        <Link href={`/forms/${form.id}/edit`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors">
            <Pencil className="w-3 h-3 mr-2" />
            Editar
          </Button>
        </Link>
        <Link href={`/forms/${form.id}/responses`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200 transition-colors">
            <BarChart3 className="w-3 h-3 mr-2" />
            Respostas
          </Button>
        </Link>
      </div>
      </div>
    </Card>

    {isRenaming && (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setIsRenaming(false)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-base font-semibold text-slate-900 mb-4">Renomear formulário</h3>
          <input
            autoFocus
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') renameForm(); if (e.key === 'Escape') setIsRenaming(false) }}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setIsRenaming(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
            <button onClick={renameForm} className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors">Salvar</button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
