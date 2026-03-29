'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, Folder } from '@/lib/database.types'
import { FormCard } from '@/components/dashboard/form-card'
import { Folder as FolderIcon, FolderOpen, Plus, Files } from 'lucide-react'
import { toast } from 'sonner'

type FolderFilter = 'all' | 'unassigned' | string

type FolderAssignments = Record<string, string | null>

interface DashboardShellProps {
  forms: Form[]
  folders: Folder[]
  responseCounts: Record<string, number>
}

function buildAssignments(forms: Form[]): FolderAssignments {
  return forms.reduce<FolderAssignments>((acc, form) => {
    acc[form.id] = form.folder_id ?? null
    return acc
  }, {})
}

export function DashboardShell({ forms, folders: initialFolders, responseCounts }: DashboardShellProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [folders, setFolders] = useState<Folder[]>(initialFolders)
  const [assignments, setAssignments] = useState<FolderAssignments>(() => buildAssignments(forms))
  const [selectedFilter, setSelectedFilter] = useState<FolderFilter>('all')
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const formsWithFolders = useMemo(() => {
    return forms.map((form) => {
      const folderId = assignments[form.id] ?? form.folder_id ?? null
      const folder = folders.find((item) => item.id === folderId) || null

      return {
        ...form,
        folder_id: folderId,
        folder,
      }
    })
  }, [assignments, folders, forms])

  const visibleForms = useMemo(() => {
    if (selectedFilter === 'all') return formsWithFolders
    if (selectedFilter === 'unassigned') {
      return formsWithFolders.filter((form) => !form.folder_id)
    }

    return formsWithFolders.filter((form) => form.folder_id === selectedFilter)
  }, [formsWithFolders, selectedFilter])

  const selectedFolderName = useMemo(() => {
    if (selectedFilter === 'all') return 'Todos os formulários'
    if (selectedFilter === 'unassigned') return 'Sem pasta'
    return folders.find((folder) => folder.id === selectedFilter)?.name || 'Pasta'
  }, [folders, selectedFilter])

  const refreshDashboard = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  const handleCreateFolder = async () => {
    const trimmedName = newFolderName.trim()

    if (!trimmedName) {
      toast.error('Digite um nome para a pasta')
      return
    }

    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível criar a pasta')
      }

      const folder = payload.folder as Folder
      setFolders((current) => [...current, folder])
      setNewFolderName('')
      setIsFolderDialogOpen(false)
      setSelectedFilter(folder.id)
      toast.success('Pasta criada com sucesso')
      refreshDashboard()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a pasta')
    }
  }

  const handleMoveFormToFolder = async (formId: string, folderId: string | null) => {
    const previousFolderId = assignments[formId] ?? forms.find((form) => form.id === formId)?.folder_id ?? null

    setAssignments((current) => ({
      ...current,
      [formId]: folderId,
    }))

    try {
      const response = await fetch(`/api/forms/${formId}/folder`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder_id: folderId }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível mover o formulário')
      }

      toast.success(folderId ? 'Formulário movido para a pasta' : 'Formulário removido da pasta')
      refreshDashboard()
    } catch (error) {
      setAssignments((current) => ({
        ...current,
        [formId]: previousFolderId,
      }))
      toast.error(error instanceof Error ? error.message : 'Não foi possível mover o formulário')
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 px-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Organização</p>
          </div>

          <div className="space-y-1.5">
            <button
              onClick={() => setSelectedFilter('all')}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedFilter === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              <span className="flex items-center gap-2">
                <Files className="h-4 w-4" />
                📋 Todos os formulários
              </span>
              <Badge variant="secondary" className="bg-white text-slate-500">{forms.length}</Badge>
            </button>

            <button
              onClick={() => setSelectedFilter('unassigned')}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedFilter === 'unassigned' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                📁 Sem pasta
              </span>
              <Badge variant="secondary" className="bg-white text-slate-500">
                {formsWithFolders.filter((form) => !form.folder_id).length}
              </Badge>
            </button>

            {folders.length > 0 && (
              <div className="pt-2">
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pastas</p>
                <div className="space-y-1">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFilter(folder.id)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedFilter === folder.id ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FolderIcon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </span>
                      <Badge variant="secondary" className="bg-white text-slate-500">
                        {formsWithFolders.filter((form) => form.folder_id === folder.id).length}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => setIsFolderDialogOpen(true)}
              disabled={isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova pasta
            </Button>
          </div>
        </aside>

        <div>
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{selectedFolderName}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {visibleForms.length} formulário{visibleForms.length === 1 ? '' : 's'} nesta visualização
              </p>
            </div>
          </div>

          {visibleForms.length === 0 ? (
            <Card className="border-dashed border-slate-200 p-10 text-center text-slate-500">
              Nenhum formulário encontrado nessa pasta.
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleForms.map((form) => (
                <FormCard
                  key={form.id}
                  form={form}
                  responseCount={responseCounts[form.id] || 0}
                  currentFolder={form.folder}
                  folders={folders}
                  onMoveToFolder={handleMoveFormToFolder}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova pasta</DialogTitle>
            <DialogDescription>
              Crie uma pasta para organizar seus formulários no dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="folder-name" className="text-sm font-medium text-slate-700">
              Nome da pasta
            </label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="Ex: Leads, Clientes, Campanhas"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateFolder()
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFolderDialogOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={() => void handleCreateFolder()} disabled={isPending}>
              Criar pasta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
