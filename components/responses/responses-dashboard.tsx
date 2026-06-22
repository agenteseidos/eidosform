'use client'

import { useState, useMemo, useRef, type ReactNode, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Form, Response, QuestionConfig, Json } from '@/lib/database.types'
import { PLANS, type PlanName } from '@/lib/plan-definitions'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Search,
  Download,
  Trash2,
  MoreVertical,
  FileText,
  ExternalLink,
  Copy,
  Pencil,
  Image as ImageIcon,
  File,
  Eye,
  CheckCircle2,
  Clock,
  BarChart3,
  Users,
  X,
  Lock,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react'

interface ResponsesDashboardProps {
  form: Form
  responses: Response[]
  userPlan?: string
  totalResponseCount?: number
  hasMoreResponses?: boolean
  initialResponseId?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: string) {
  return new Date(date).toLocaleString('pt-BR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDateShort(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

interface FileUpload {
  name: string
  type: string
  size?: number
  data?: string
  url?: string
}

function isFileUpload(answer: Json): boolean {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return false
  const obj = answer as Record<string, unknown>
  return 'name' in obj && typeof obj.name === 'string' &&
    (('url' in obj && typeof obj.url === 'string') || ('data' in obj && typeof obj.data === 'string'))
}

function asFileUpload(answer: Json): FileUpload {
  return answer as unknown as FileUpload
}

function getFileUrl(file: FileUpload): string {
  return file.url || file.data || ''
}

function formatResponseValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return formatResponseValue(parsed)
      }
    } catch { /* não é JSON */ }
    return value
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.map(v => formatResponseValue(v)).join('; ')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const addressKeys = ['cep', 'rua', 'street', 'logradouro', 'bairro', 'neighborhood', 'cidade', 'city', 'estado', 'state', 'uf', 'numero', 'number', 'complemento']
    const keys = Object.keys(obj)
    const isAddress = keys.some(k => ['cep', 'rua', 'street', 'logradouro'].includes(k.toLowerCase())) &&
                      keys.some(k => addressKeys.includes(k.toLowerCase()))
    if (isAddress) {
      const rua = obj.rua || obj.street || obj.logradouro || ''
      const numero = obj.numero || obj.number || ''
      const complemento = obj.complemento || ''
      const bairro = obj.bairro || obj.neighborhood || ''
      const cep = obj.cep ? String(obj.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : ''
      const cidade = obj.cidade || obj.city || ''
      const estado = obj.estado || obj.state || obj.uf || ''
      const parts: string[] = []
      if (rua) parts.push(String(rua) + (numero ? `, ${numero}` : '') + (complemento ? ` — ${complemento}` : ''))
      if (bairro) parts.push(String(bairro))
      const location: string[] = []
      if (cep) location.push(`CEP ${cep}`)
      if (cidade || estado) location.push([cidade, estado].filter(Boolean).join('/'))
      if (location.length) parts.push(location.join(' — '))
      return parts.join(', ') || Object.values(obj).filter(Boolean).join(', ')
    }
    return Object.values(obj).filter(v => v !== null && v !== undefined && v !== '').map(v => String(v)).join(', ')
  }
  return String(value)
}

function formatAnswer(answer: Json): string {
  if (answer === null || answer === undefined) return '-'
  if (typeof answer === 'boolean') return answer ? 'Sim' : 'Não'
  if (Array.isArray(answer)) return answer.join('; ')
  if (typeof answer === 'object') {
    if (isFileUpload(answer)) return asFileUpload(answer).name
    return formatResponseValue(answer)
  }
  return formatResponseValue(answer)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="p-5 flex items-start gap-4 min-h-[90px]">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color ? `${color}15` : undefined }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </Card>
    </motion.div>
  )
}

// ─── Área com rolagem horizontal arrastável + scrollbar visível ───────────────
// Container próprio (não o ScrollArea do Radix) p/ ter controle total: barra de
// rolagem nítida e "clicar, segurar e arrastar pro lado" rola a tabela. Um arraste
// real engole o clique seguinte (não abre o modal da linha) e suprime a seleção de
// texto só enquanto arrasta (clique simples ainda permite selecionar/copiar).
function DragScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useRef({ down: false, startX: 0, startScroll: 0, moved: false })

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    state.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false }
  }
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !state.current.down) return
    const dx = e.clientX - state.current.startX
    if (!state.current.moved && Math.abs(dx) > 4) {
      state.current.moved = true
      el.style.userSelect = 'none'
    }
    if (state.current.moved) el.scrollLeft = state.current.startScroll - dx
  }
  const stop = () => {
    const el = ref.current
    state.current.down = false
    if (el) el.style.userSelect = ''
  }
  const onClickCapture = (e: RMouseEvent<HTMLDivElement>) => {
    if (state.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      state.current.moved = false
    }
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerLeave={stop}
      onClickCapture={onClickCapture}
      className={cn(
        'overflow-x-auto overflow-y-hidden cursor-grab active:cursor-grabbing',
        // Scrollbar horizontal bem visível (webkit) + Firefox
        '[&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-track]:rounded-full',
        '[&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-slate-100',
        '[scrollbar-width:auto] [scrollbar-color:#cbd5e1_#f1f5f9]',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ─── Preview de arquivo (imagem/PDF/outros) — reutilizado pela tabela E pelo modal ─
function FilePreviewDialog({ file, onClose }: { file: FileUpload | null; onClose: () => void }) {
  if (!file) return null
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {file.type?.startsWith('image/') ? <ImageIcon className="w-5 h-5 text-blue-600" /> : <File className="w-5 h-5 text-blue-600" />}
            <span className="truncate">{file.name}</span>
          </DialogTitle>
          <DialogDescription>
            {file.size ? formatFileSize(file.size) + ' • ' : ''}{file.type}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto mt-4">
          {file.type?.startsWith('image/') ? (
            <Image src={getFileUrl(file)} alt={file.name} width={800} height={600} className="max-w-full h-auto rounded-lg mx-auto" />
          ) : file.type === 'application/pdf' ? (
            // sandbox sem allow-scripts: se o anexo for um HTML disfarçado de PDF
            // (MIME confusion), nada executa no contexto do dashboard.
            <iframe src={getFileUrl(file)} sandbox="" className="w-full h-[60vh] rounded-lg border" title={file.name} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <File className="w-16 h-16 mb-4 opacity-40" />
              <p className="text-sm">Preview não disponível para este tipo de arquivo</p>
            </div>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {file.url ? (
            <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name}>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white"><Download className="w-4 h-4 mr-2" />Baixar</Button>
            </a>
          ) : file.data ? (
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
              const link = document.createElement('a')
              link.href = file.data!
              link.download = file.name
              link.click()
            }}>
              <Download className="w-4 h-4 mr-2" />Baixar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Individual Response Dialog ───────────────────────────────────────────────

function ResponseDetailDialog({
  response,
  questions,
  onClose,
  onPreviewFile,
}: {
  response: Response | null
  questions: QuestionConfig[]
  onClose: () => void
  onPreviewFile: (file: FileUpload) => void
}) {
  if (!response) return null
  const answers = response.answers as Record<string, Json>

  return (
    <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Resposta — {formatDate(response.submitted_at)}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              {response.completed ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Completa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <Clock className="w-3.5 h-3.5" /> Parcial ({response.last_question_answered ?? 0}/{questions.length})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Corpo rolável com scrollbar SEMPRE visível (o ScrollArea do Radix é
              type="hover" → a barra sumia). min-h-0 deixa o flex-1 encolher e rolar. */}
          <div className="flex-1 min-h-0 mt-4 pr-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full [scrollbar-width:thin] [scrollbar-color:#cbd5e1_#f1f5f9]">
            <div className="space-y-5 pb-4">
              {questions.map((q, idx) => {
                const answer = answers[q.id]
                return (
                  <div key={q.id} className="border border-slate-100 rounded-xl p-4">
                    <p className="text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                      Pergunta {idx + 1}
                    </p>
                    <p className="text-sm font-semibold text-slate-800 mb-2">{q.title}</p>
                    {answer === undefined || answer === null || answer === '' ? (
                      <p className="text-sm text-slate-400 italic">Não respondida</p>
                    ) : isFileUpload(answer) ? (
                      <button
                        onClick={() => onPreviewFile(asFileUpload(answer))}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm transition-colors"
                      >
                        {asFileUpload(answer).type?.startsWith('image/') ? (
                          <ImageIcon className="w-4 h-4" />
                        ) : (
                          <File className="w-4 h-4" />
                        )}
                        {asFileUpload(answer).name}
                        <Eye className="w-3.5 h-3.5 ml-1 opacity-60" />
                      </button>
                    ) : (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{formatAnswer(answer)}</p>
                    )}
                  </div>
                )
              })}

              {/* UTM tracking data */}
              {(() => {
                const metaEvents = Array.isArray(response.meta_events)
                  ? response.meta_events.filter((event): event is string => typeof event === 'string' && event.trim().length > 0)
                  : []

                if (metaEvents.length === 0) return null

                return (
                  <div className="border border-slate-100 rounded-xl p-4">
                    <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                      Meta Events
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {metaEvents.map((event) => (
                        <Badge key={event} variant="secondary" className="text-[11px]">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {(() => {
                const utmEntries = [
                  ['utm_source', response.utm_source],
                  ['utm_medium', response.utm_medium],
                  ['utm_campaign', response.utm_campaign],
                  ['utm_term', response.utm_term],
                  ['utm_content', response.utm_content],
                ].filter(([, v]) => v) as [string, string][]
                if (utmEntries.length === 0) return null
                return (
                  <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                    <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                      UTM Tracking
                    </p>
                    <div className="space-y-1">
                      {utmEntries.map(([key, val]) => (
                        <div key={key} className="flex items-center gap-2 text-sm">
                          <span className="text-slate-500 font-mono text-xs">{key}</span>
                          <span className="text-slate-700">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ResponsesDashboard({ form, responses: initialResponses, userPlan = 'free', totalResponseCount, initialResponseId }: ResponsesDashboardProps) {
  const supabase = createClient()
  const questions = (form.questions as QuestionConfig[]) || []

  const [responses, setResponses] = useState(initialResponses)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'partial'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [responseToDelete, setResponseToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // Abre direto a resposta vinda do link "Ver resposta" do e-mail (?response=<id>).
  const [selectedResponse, setSelectedResponse] = useState<Response | null>(
    () => (initialResponseId ? initialResponses.find(r => r.id === initialResponseId) ?? null : null)
  )
  const [page, setPage] = useState(1)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  // Preview de arquivo aberto a partir da TABELA (compartilha o mesmo dialog do modal).
  const [filePreview, setFilePreview] = useState<FileUpload | null>(null)
  const PAGE_SIZE = 20

  // ── Metrics ──
  const metrics = useMemo(() => {
    const total = responses.length
    const completed = responses.filter(r => r.completed).length
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

    // Group by day for recent activity
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayCount = responses.filter(r => new Date(r.submitted_at) >= today).length

    return { total, completed, completionRate, todayCount }
  }, [responses])

  // ── Filters ──
  const filteredResponses = useMemo(() => {
    let list = responses

    // Status filter
    if (statusFilter === 'complete') list = list.filter(r => r.completed)
    else if (statusFilter === 'partial') list = list.filter(r => !r.completed)

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date()
      if (dateFilter === 'today') cutoff.setHours(0, 0, 0, 0)
      else if (dateFilter === '7d') cutoff.setDate(now.getDate() - 7)
      else if (dateFilter === '30d') cutoff.setDate(now.getDate() - 30)
      list = list.filter(r => new Date(r.submitted_at) >= cutoff)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(r => {
        const ans = r.answers as Record<string, Json>
        return Object.values(ans).some(a => formatAnswer(a).toLowerCase().includes(q))
      })
    }

    return list
  }, [responses, statusFilter, dateFilter, searchQuery])

  const hasActiveFilters = statusFilter !== 'all' || dateFilter !== 'all' || searchQuery.trim() !== ''

  // Reset page on filter change
  const totalPages = Math.ceil(filteredResponses.length / PAGE_SIZE)
  const paginatedResponses = filteredResponses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset da página acontece nos handlers de filtro (updateSearchQuery etc.) —
  // setState num useEffect disparava render em cascata (lint react-hooks).
  const updateSearchQuery = (v: string) => { setSearchQuery(v); setPage(1) }
  const updateStatusFilter = (v: typeof statusFilter) => { setStatusFilter(v); setPage(1) }
  const updateDateFilter = (v: typeof dateFilter) => { setDateFilter(v); setPage(1) }
  const clearFilters = () => { setSearchQuery(''); setStatusFilter('all'); setDateFilter('all'); setPage(1) }

  const handleDelete = async () => {
    if (!responseToDelete) return
    setIsDeleting(true)
    const { error } = await supabase.from('responses').delete().eq('id', responseToDelete)
    if (error) {
      toast.error('Erro ao excluir resposta')
    } else {
      setResponses(prev => prev.filter(r => r.id !== responseToDelete))
      toast.success('Resposta excluída')
    }
    setIsDeleting(false)
    setDeleteDialogOpen(false)
    setResponseToDelete(null)
  }

  const exportCSVFromAPI = () => {
    const url = `/api/forms/${form.id}/export?format=csv`
    const link = document.createElement('a')
    link.href = url
    link.download = `${form.title || 'form'}-respostas.csv`
    link.click()
  }

  const exportXLSXFromAPI = () => {
    const url = `/api/forms/${form.id}/export?format=xlsx`
    const link = document.createElement('a')
    link.href = url
    link.download = `${form.title || 'form'}-respostas.xlsx`
    link.click()
  }

  // PDF gerado no NAVEGADOR: o servidor só devolve os dados (rápido), e a montagem do
  // PDF roda aqui — sem o limite de 30s da função serverless que fazia o download falhar.
  // A biblioteca entra sob demanda (import dinâmico) p/ não pesar o bundle inicial.
  const exportPDFFromAPI = async () => {
    if (isExportingPdf) return
    setIsExportingPdf(true)
    const toastId = toast.loading('Gerando PDF…')
    try {
      const res = await fetch(`/api/forms/${form.id}/export?format=json`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Falha ao carregar as respostas')
      }
      const { title, questions: qs, responses: rows, hideBranding } = await res.json()
      const { buildPdfExport } = await import('@/lib/export-pdf')
      const pdf = buildPdfExport(title, qs, rows, hideBranding)
      const blob = new Blob([pdf as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${form.title || 'form'}-respostas.pdf`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('PDF gerado!', { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar PDF', { id: toastId })
    } finally {
      setIsExportingPdf(false)
    }
  }

  const copyFormLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/f/${form.slug}`)
    toast.success('Link copiado!')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12 py-8">

      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/forms">
            <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]">
              <ArrowLeft className="w-4 h-4 mr-2" />Voltar
            </Button>
          </Link>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{form.title}</h1>
              {form.status === 'published' && <Badge className="bg-emerald-100 text-emerald-700 border-0">Publicado</Badge>}
              {form.status === 'draft' && <Badge variant="secondary">Rascunho</Badge>}
              {form.status === 'closed' && <Badge className="bg-amber-100 text-amber-700 border-0">Encerrado</Badge>}
            </div>
            <p className="text-slate-500 mt-1 text-sm">
              {totalResponseCount != null && totalResponseCount !== responses.length
                ? `${totalResponseCount} ${totalResponseCount === 1 ? 'resposta' : 'respostas'} no total (mostrando ${responses.length} mais recentes)`
                : `${responses.length} ${responses.length === 1 ? 'resposta' : 'respostas'} no total`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/forms/${form.id}/edit`}>
              <Button variant="outline" size="sm"><Pencil className="w-4 h-4 mr-2" />Editar</Button>
            </Link>
            {form.status === 'published' && (
              <>
                <Button variant="outline" size="sm" onClick={copyFormLink}><Copy className="w-4 h-4 mr-2" />Copiar link</Button>
                <Link href={`/f/${form.slug}`} target="_blank">
                  <Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-2" />Ver formulário</Button>
                </Link>
              </>
            )}
            {userPlan === 'free' ? (
              <Link href="/billing">
                <Button size="sm" variant="outline" className="text-slate-500 border-slate-300">
                  <Lock className="w-4 h-4 mr-2" />Exportar
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">Starter+</Badge>
                </Button>
              </Link>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Download className="w-4 h-4 mr-2" />Exportar
                    <ChevronDown className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportCSVFromAPI}>
                    <FileText className="w-4 h-4 mr-2" />CSV
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={exportXLSXFromAPI}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {PLANS[userPlan as PlanName]?.pdfExport && (
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); void exportPDFFromAPI() }}
                      disabled={isExportingPdf}
                    >
                      <File className="w-4 h-4 mr-2" />{isExportingPdf ? 'Gerando PDF…' : 'PDF'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          icon={<Users className="w-5 h-5" />}
          label="Total respostas"
          value={metrics.total}
          sub={`${metrics.todayCount} hoje`}
          color="#3B82F6"
        />
        <MetricCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Completas"
          value={metrics.completed}
          color="#10B981"
        />
        <MetricCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Taxa de conclusão"
          value={`${metrics.completionRate}%`}
          color="#8B5CF6"
        />
        <MetricCard
          icon={<Clock className="w-5 h-5" />}
          label="Parciais"
          value={metrics.total - metrics.completed}
          color="#F59E0B"
        />
      </div>

      {/* ── Empty state ── */}
      {responses.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Nenhuma resposta ainda</h2>
          <p className="text-slate-500 max-w-sm mx-auto text-sm">
            {form.status === 'published'
              ? 'Compartilhe seu formulário para começar a receber respostas'
              : 'Publique seu formulário para começar a receber respostas'}
          </p>
          {form.status === 'published' && (
            <Button onClick={copyFormLink} className="mt-6 bg-blue-600 hover:bg-blue-700 text-white">
              <Copy className="w-4 h-4 mr-2" />Copiar link
            </Button>
          )}
        </Card>
      ) : (
        <>
          {/* ── Toolbar ── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar nas respostas…"
                value={searchQuery}
                onChange={e => updateSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={v => updateStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="complete">Completas</SelectItem>
                <SelectItem value="partial">Parciais</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateFilter} onValueChange={v => updateDateFilter(v as typeof dateFilter)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo período</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-slate-500"
              >
                <X className="w-4 h-4 mr-1" />Limpar
              </Button>
            )}

            
          </div>

          {/* Count */}
          

          {/* ── Table ── */}
          <Card className="overflow-hidden relative">
            <DragScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-[160px] sticky left-0 bg-slate-50 z-10 pl-5 text-xs">Enviado em</TableHead>
                    <TableHead className="w-[100px] text-xs">Status</TableHead>
                    <TableHead className="min-w-[200px] text-xs">Eventos</TableHead>
                    {questions.map((q, i) => (
                      <TableHead key={q.id} className="min-w-[180px] text-xs">
                        <span className="text-slate-400 mr-1">{i + 1}.</span>{q.title || 'Sem título'}
                        {q.required && <span className="text-red-400 ml-0.5">*</span>}
                      </TableHead>
                    ))}
                    <TableHead className="w-[80px] sticky right-0 bg-slate-50 z-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResponses.map(response => {
                    const ans = response.answers as Record<string, Json>
                    return (
                      <TableRow
                        key={response.id}
                        className="hover:bg-blue-50/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedResponse(response)}
                      >
                        <TableCell className="sticky left-0 bg-white z-10 pl-5 text-sm font-medium text-slate-700">
                          {formatDateShort(response.submitted_at)}
                          <br />
                          <span className="text-xs text-slate-400">
                            {new Date(response.submitted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {response.completed ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-0 text-xs">Completa</Badge>
                          ) : (
                            <Badge className="bg-amber-50 text-amber-600 border-0 text-xs">Parcial</Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <span className="line-clamp-2 text-sm text-slate-700">
                            {Array.isArray(response.meta_events) && response.meta_events.length > 0
                              ? response.meta_events.join('; ')
                              : '-'}
                          </span>
                        </TableCell>
                        {questions.map(q => {
                          const answer = ans[q.id]
                          if (isFileUpload(answer)) {
                            const file = asFileUpload(answer)
                            return (
                              <TableCell key={q.id} onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => setFilePreview(file)}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs transition-colors group"
                                >
                                  {file.type?.startsWith('image/') ? <ImageIcon className="w-3.5 h-3.5" /> : <File className="w-3.5 h-3.5" />}
                                  <span className="truncate max-w-[120px]">{file.name}</span>
                                  <Eye className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                                </button>
                              </TableCell>
                            )
                          }
                          return (
                            <TableCell key={q.id} className="max-w-[240px]">
                              <span className="line-clamp-2 text-sm text-slate-700">{formatAnswer(answer)}</span>
                            </TableCell>
                          )
                        })}
                        <TableCell className="sticky right-0 bg-white z-10" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-11 w-11 p-0"
                              onClick={() => setSelectedResponse(response)}
                              title="Ver resposta"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-11 w-11 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => { setResponseToDelete(response.id); setDeleteDialogOpen(true) }}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </DragScrollArea>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-slate-500">
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredResponses.length)} de {filteredResponses.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="min-h-[44px]"
                >
                  Anterior
                </Button>
                <span className="text-sm text-slate-600 px-2">{page} / {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="min-h-[44px]"
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}

          {filteredResponses.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500 text-sm">Nenhuma resposta encontrada para os filtros atuais</p>
              <Button variant="link" className="mt-2 text-sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir resposta</DialogTitle>
            <DialogDescription>
              Tem certeza? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Response detail dialog ── */}
      <ResponseDetailDialog
        response={selectedResponse}
        questions={questions}
        onClose={() => setSelectedResponse(null)}
        onPreviewFile={setFilePreview}
      />

      {/* ── Preview de arquivo (tabela + modal compartilham) ── */}
      <FilePreviewDialog file={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  )
}
