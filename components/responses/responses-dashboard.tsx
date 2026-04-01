'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Form, Response, QuestionConfig, Json } from '@/lib/database.types'
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
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
} from 'lucide-react'

interface ResponsesDashboardProps {
  form: Form
  responses: Response[]
  userPlan?: string
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
  if (Array.isArray(value)) return value.map(v => formatResponseValue(v)).join(', ')
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
  if (Array.isArray(answer)) return answer.join(', ')
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

// ─── Individual Response Dialog ───────────────────────────────────────────────

function ResponseDetailDialog({
  response,
  questions,
  onClose,
}: {
  response: Response | null
  questions: QuestionConfig[]
  onClose: () => void
}) {
  const [filePreview, setFilePreview] = useState<FileUpload | null>(null)

  if (!response) return null
  const answers = response.answers as Record<string, Json>

  return (
    <>
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

          <ScrollArea className="flex-1 mt-4 pr-1">
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
                        onClick={() => setFilePreview(asFileUpload(answer))}
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
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File preview inside response dialog */}
      {filePreview && (
        <Dialog open onOpenChange={() => setFilePreview(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {filePreview.type?.startsWith('image/') ? <ImageIcon className="w-5 h-5 text-blue-600" /> : <File className="w-5 h-5 text-blue-600" />}
                <span className="truncate">{filePreview.name}</span>
              </DialogTitle>
              <DialogDescription>
                {filePreview.size ? formatFileSize(filePreview.size) + ' • ' : ''}{filePreview.type}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-auto mt-4">
              {filePreview.type?.startsWith('image/') ? (
                <img src={getFileUrl(filePreview)} alt={filePreview.name} className="max-w-full h-auto rounded-lg mx-auto" />
              ) : filePreview.type === 'application/pdf' ? (
                <iframe src={getFileUrl(filePreview)} className="w-full h-[60vh] rounded-lg border" title={filePreview.name} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <File className="w-16 h-16 mb-4 opacity-40" />
                  <p className="text-sm">Preview não disponível para este tipo de arquivo</p>
                </div>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setFilePreview(null)}>Fechar</Button>
              {filePreview.url ? (
                <a href={filePreview.url} target="_blank" rel="noopener noreferrer" download={filePreview.name}>
                  <Button className="bg-blue-600 hover:bg-blue-700"><Download className="w-4 h-4 mr-2" />Baixar</Button>
                </a>
              ) : filePreview.data ? (
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => {
                  const link = document.createElement('a')
                  link.href = filePreview.data!
                  link.download = filePreview.name
                  link.click()
                }}>
                  <Download className="w-4 h-4 mr-2" />Baixar
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ResponsesDashboard({ form, responses: initialResponses, userPlan = 'free' }: ResponsesDashboardProps) {
  const supabase = createClient()
  const questions = (form.questions as QuestionConfig[]) || []

  const [responses, setResponses] = useState(initialResponses)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'partial'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [responseToDelete, setResponseToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedResponse, setSelectedResponse] = useState<Response | null>(null)

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

  const exportToCSV = () => {
    if (filteredResponses.length === 0) { toast.error('Nenhuma resposta para exportar'); return }
    const headers = ['Enviado em', 'Status', ...questions.map(q => q.title || 'Sem título')]
    const rows = filteredResponses.map(r => {
      const ans = r.answers as Record<string, Json>
      return [
        formatDate(r.submitted_at),
        r.completed ? 'Completa' : 'Parcial',
        ...questions.map(q => formatAnswer(ans[q.id]))
      ]
    })
    const csv = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${form.title || 'form'}-respostas-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
    toast.success('CSV exportado com sucesso')
  }

  const exportCSVFromAPI = () => {
    const url = `/api/forms/${form.id}/export?format=csv`
    const link = document.createElement('a')
    link.href = url
    link.download = `${form.title || 'form'}-respostas.csv`
    link.click()
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
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
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
              {responses.length} {responses.length === 1 ? 'resposta' : 'respostas'} no total
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
                  <Lock className="w-4 h-4 mr-2" />Exportar CSV
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">Starter+</Badge>
                </Button>
              </Link>
            ) : (
              <Button onClick={exportCSVFromAPI} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Download className="w-4 h-4 mr-2" />Exportar CSV
              </Button>
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
            <Button onClick={copyFormLink} className="mt-6 bg-blue-600 hover:bg-blue-700">
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
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="complete">Completas</SelectItem>
                <SelectItem value="partial">Parciais</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateFilter} onValueChange={v => setDateFilter(v as typeof dateFilter)}>
              <SelectTrigger className="w-40">
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
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDateFilter('all') }}
                className="text-slate-500"
              >
                <X className="w-4 h-4 mr-1" />Limpar
              </Button>
            )}

            
          </div>

          {/* Count */}
          

          {/* ── Table ── */}
          <Card className="overflow-hidden relative">
            <ScrollArea className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-[160px] sticky left-0 bg-slate-50 z-10 pl-5 text-xs">Enviado em</TableHead>
                    <TableHead className="w-[100px] text-xs">Status</TableHead>
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
                  {filteredResponses.map(response => {
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
                        {questions.map(q => {
                          const answer = ans[q.id]
                          if (isFileUpload(answer)) {
                            const file = asFileUpload(answer)
                            return (
                              <TableCell key={q.id} onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    // open file inline by selecting response + scrolling to question
                                    setSelectedResponse(response)
                                  }}
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
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </Card>

          {filteredResponses.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500 text-sm">Nenhuma resposta encontrada para os filtros atuais</p>
              <Button variant="link" className="mt-2 text-sm" onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDateFilter('all') }}>
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
      />
    </div>
  )
}
