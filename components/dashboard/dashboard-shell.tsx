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
import { Folder as FolderIcon, FolderOpen, Plus, Files, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  const [isMobileFoldersOpen, setIsMobileFoldersOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  // Gerenciamento de pastas existentes
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null)
  const [folderToRename, setFolderToRename] = useState<Folder | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isProcessingFolder, setIsProcessingFolder] = useState(false)

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

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return
    setIsProcessingFolder(true)
    try {
      const response = await fetch(`/api/folders/${folderToDelete.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível excluir a pasta')
      // Os formulários da pasta voltam pra "Sem pasta" — refletir no estado local.
      setAssignments((current) => {
        const next = { ...current }
        for (const [formId, fid] of Object.entries(current)) {
          if (fid === folderToDelete.id) next[formId] = null
        }
        return next
      })
      setFolders((current) => current.filter((f) => f.id !== folderToDelete.id))
      if (selectedFilter === folderToDelete.id) setSelectedFilter('all')
      toast.success('Pasta excluída')
      setFolderToDelete(null)
      refreshDashboard()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir a pasta')
    } finally {
      setIsProcessingFolder(false)
    }
  }

  const handleRenameFolder = async () => {
    if (!folderToRename) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      toast.error('Digite um nome para a pasta')
      return
    }
    if (trimmed === folderToRename.name) {
      setFolderToRename(null)
      return
    }
    setIsProcessingFolder(true)
    try {
      const response = await fetch(`/api/folders/${folderToRename.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível renomear a pasta')
      const updated = payload.folder as Folder
      setFolders((current) => current.map((f) => (f.id === updated.id ? updated : f)))
      toast.success('Pasta renomeada')
      setFolderToRename(null)
      refreshDashboard()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível renomear a pasta')
    } finally {
      setIsProcessingFolder(false)
    }
  }

  const formsInFolderCount = (folderId: string) =>
    formsWithFolders.filter((form) => form.folder_id === folderId).length

  // Renderiza o menu "..." que aparece no hover. Reusável entre desktop e mobile.
  const renderFolderActions = (folder: Folder) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Ações da pasta ${folder.name}`}
          onClick={(e) => e.stopPropagation()}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 lg:opacity-0 lg:group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onSelect={() => {
            setFolderToRename(folder)
            setRenameValue(folder.name)
          }}
        >
          <Pencil className="mr-2 h-4 w-4" /> Renomear
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => setFolderToDelete(folder)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:block hidden">
          <div className="mb-3 px-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Organização</p>
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
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pastas</p>
                <div className="space-y-1">
                  {folders.map((folder) => {
                    const isSelected = selectedFilter === folder.id
                    return (
                      <div
                        key={folder.id}
                        className={`group flex w-full items-center rounded-xl pr-1 transition-colors ${isSelected ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                      >
                        <button
                          onClick={() => setSelectedFilter(folder.id)}
                          className="flex flex-1 min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FolderIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{folder.name}</span>
                          </span>
                          <Badge variant="secondary" className="bg-white text-slate-500">
                            {formsInFolderCount(folder.id)}
                          </Badge>
                        </button>
                        {renderFolderActions(folder)}
                      </div>
                    )
                  })}
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
          {/* Mobile folder filter */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 sm:px-5 py-3 sm:py-4 shadow-sm">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-slate-900 truncate">{selectedFolderName}</h2>
              <p className="mt-0.5 sm:mt-1 text-sm text-slate-500">
                {visibleForms.length} formulário{visibleForms.length === 1 ? '' : 's'} nesta visualização
              </p>
            </div>
            <Select
              value={selectedFilter}
              onValueChange={(value) => setSelectedFilter(value as FolderFilter)}
            >
              <SelectTrigger className="lg:hidden w-full sm:w-auto sm:min-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">📋 Todos ({forms.length})</SelectItem>
                <SelectItem value="unassigned">📁 Sem pasta ({formsWithFolders.filter((f) => !f.folder_id).length})</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    📂 {folder.name} ({formsWithFolders.filter((f) => f.folder_id === folder.id).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden h-11 w-11 shrink-0"
              onClick={() => setIsMobileFoldersOpen(true)}
              aria-label="Ver pastas"
              title="Ver pastas"
            >
              <FolderIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden h-11 w-11 shrink-0"
              onClick={() => setIsFolderDialogOpen(true)}
              disabled={isPending}
              aria-label="Nova pasta"
              title="Nova pasta"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {visibleForms.length === 0 ? (
            <Card className="border-dashed border-slate-200 p-10 text-center text-slate-500">
              Nenhum formulário encontrado nessa pasta.
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

      {/* Mobile folders drawer */}
      <Dialog open={isMobileFoldersOpen} onOpenChange={setIsMobileFoldersOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Organização</DialogTitle>
            <DialogDescription>Navegue pelas suas pastas</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <button
              onClick={() => { setSelectedFilter('all'); setIsMobileFoldersOpen(false) }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedFilter === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="flex items-center gap-2"><Files className="h-4 w-4" /> 📋 Todos</span>
              <Badge variant="secondary" className="bg-white text-slate-500">{forms.length}</Badge>
            </button>
            <button
              onClick={() => { setSelectedFilter('unassigned'); setIsMobileFoldersOpen(false) }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedFilter === 'unassigned' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> 📁 Sem pasta</span>
              <Badge variant="secondary" className="bg-white text-slate-500">{formsWithFolders.filter((f) => !f.folder_id).length}</Badge>
            </button>
            {folders.map((folder) => {
              const isSelected = selectedFilter === folder.id
              return (
                <div
                  key={folder.id}
                  className={`group flex w-full items-center rounded-xl pr-1 transition-colors ${isSelected ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <button
                    onClick={() => { setSelectedFilter(folder.id); setIsMobileFoldersOpen(false) }}
                    className="flex flex-1 min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2"><FolderIcon className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span></span>
                    <Badge variant="secondary" className="bg-white text-slate-500">{formsInFolderCount(folder.id)}</Badge>
                  </button>
                  {renderFolderActions(folder)}
                </div>
              )
            })}
          </div>
          <div className="border-t border-slate-100 pt-3">
            <Button variant="outline" className="w-full justify-start" onClick={() => { setIsMobileFoldersOpen(false); setIsFolderDialogOpen(true) }} disabled={isPending}>
              <Plus className="mr-2 h-4 w-4" />Nova pasta
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão de pasta */}
      <Dialog
        open={!!folderToDelete}
        onOpenChange={(open) => { if (!open) setFolderToDelete(null) }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir pasta?</DialogTitle>
            <DialogDescription>
              {folderToDelete && (
                <>
                  A pasta <strong>{folderToDelete.name}</strong> será excluída.{' '}
                  {formsInFolderCount(folderToDelete.id) > 0 ? (
                    <>
                      Os <strong>{formsInFolderCount(folderToDelete.id)} formulário{formsInFolderCount(folderToDelete.id) === 1 ? '' : 's'}</strong>{' '}
                      dentro dela voltam pra <strong>Sem pasta</strong> (não são deletados).
                    </>
                  ) : (
                    <>A pasta está vazia.</>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setFolderToDelete(null)}
              disabled={isProcessingFolder}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteFolder}
              disabled={isProcessingFolder}
            >
              {isProcessingFolder ? 'Excluindo...' : 'Excluir pasta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renomear pasta */}
      <Dialog
        open={!!folderToRename}
        onOpenChange={(open) => { if (!open) setFolderToRename(null) }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear pasta</DialogTitle>
            <DialogDescription>Digite o novo nome da pasta.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="rename-folder" className="text-sm font-medium text-slate-700">Nome da pasta</label>
            <Input
              id="rename-folder"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder() }}
              autoFocus
              disabled={isProcessingFolder}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setFolderToRename(null)}
              disabled={isProcessingFolder}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRenameFolder}
              disabled={isProcessingFolder || !renameValue.trim()}
            >
              {isProcessingFolder ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
