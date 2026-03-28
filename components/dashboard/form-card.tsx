'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreVertical,
  ExternalLink,
  BarChart3,
  Pencil,
  Copy,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { Form, Folder as FolderType, FormStatus } from '@/lib/database.types'
import { DeleteFormButton } from './delete-form-button'
import { DuplicateFormButton } from './duplicate-form-button'
import { toast } from 'sonner'

interface FormCardProps {
  form: Form
  responseCount: number
  currentFolder?: FolderType | null
  folders?: FolderType[]
  onMoveToFolder?: (formId: string, folderId: string | null) => void
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

export function FormCard({
  form,
  responseCount,
  currentFolder = null,
  folders = [],
  onMoveToFolder,
}: FormCardProps) {
  const copyFormLink = () => {
    const link = `${window.location.origin}/f/${form.slug}`
    navigator.clipboard.writeText(link)
    toast.success('Link copiado!')
  }

  return (
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
            <DuplicateFormButton formId={form.id} />
            <DropdownMenuItem 
              onClick={copyFormLink}
              className="cursor-pointer"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar link
            </DropdownMenuItem>
            {onMoveToFolder && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Folder className="mr-2 h-4 w-4" />
                  Mover para pasta
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onMoveToFolder(form.id, null)}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Sem pasta
                  </DropdownMenuItem>
                  {folders.length > 0 ? (
                    folders.map((folder) => (
                      <DropdownMenuItem key={folder.id} onClick={() => onMoveToFolder(form.id, folder.id)}>
                        <Folder className="mr-2 h-4 w-4" />
                        {folder.name}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      <Folder className="mr-2 h-4 w-4" />
                      Nenhuma pasta criada
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DeleteFormButton formId={form.id} formTitle={form.title} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {getStatusBadge(form.status)}
          <Badge variant="outline" className="border-slate-200 text-slate-500">
            <Folder className="mr-1 h-3 w-3" />
            {currentFolder?.name || 'Sem pasta'}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-sm text-slate-500 shrink-0">
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
  )
}
