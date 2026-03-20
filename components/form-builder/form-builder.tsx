'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Form, QuestionConfig, ThemePreset, FormStatus } from '@/lib/database.types'
import { questionTypes, createDefaultQuestion, getQuestionTypeInfo } from '@/lib/questions'
import { themes, themeList } from '@/lib/themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Eye,
  Save,
  Globe,
  X,
  ExternalLink,
  Copy,
  Settings,
  Palette,
  FileText,
  Pencil,
} from 'lucide-react'
import Link from 'next/link'
import { QuestionEditor } from './question-editor'
import { FormPreview } from './form-preview'

interface FormBuilderProps {
  form: Form
}

export function FormBuilder({ form: initialForm }: FormBuilderProps) {
  const router = useRouter()
  const supabase = createClient()
  
  const [form, setForm] = useState(initialForm)
  const [pixels, setPixels] = useState(initialForm.pixels || {})
  const [questions, setQuestions] = useState<QuestionConfig[]>(
    (initialForm.questions as QuestionConfig[]) || []
  )
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [activeTab, setActiveTab] = useState('questions')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'questions' | 'editor' | 'preview'>('questions')

  const selectedQuestion = questions.find(q => q.id === selectedQuestionId)

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    const updateData = {
      title: form.title,
      description: form.description,
      slug: form.slug,
      theme: form.theme,
      questions: questions,
      thank_you_message: form.thank_you_message,
      thank_you_title: form.thank_you_title || null,
      thank_you_description: form.thank_you_description || null,
      thank_you_button_text: form.thank_you_button_text || null,
      thank_you_button_url: form.thank_you_button_url || null,
      pixels: pixels,
      redirect_url: form.redirect_url || null,
      webhook_url: form.webhook_url || null,
    }
    const { error } = await supabase
      .from('forms')
      .update(updateData as never)
      .eq('id', form.id)

    if (error) {
      toast.error('Falha ao salvar formulário')
    } else {
      toast.success('Formulário salvo')
      setHasUnsavedChanges(false)
    }
    setIsSaving(false)
  }, [supabase, form, questions, pixels])

  const handlePublish = async () => {
    if (questions.length === 0) {
      toast.error('Adicione ao menos uma pergunta antes de publicar')
      return
    }

    setIsSaving(true)
    const newStatus: FormStatus = form.status === 'published' ? 'closed' : 'published'
    
    const updateData = {
      status: newStatus,
      is_published: newStatus === 'published',
      questions: questions,
      title: form.title,
      description: form.description,
      slug: form.slug,
      theme: form.theme,
      thank_you_message: form.thank_you_message,
      thank_you_title: form.thank_you_title || null,
      thank_you_description: form.thank_you_description || null,
      thank_you_button_text: form.thank_you_button_text || null,
      thank_you_button_url: form.thank_you_button_url || null,
      pixels: pixels,
      redirect_url: form.redirect_url || null,
      webhook_url: form.webhook_url || null,
    }
    const { data: updated, error } = await supabase
      .from('forms')
      .update(updateData as never)
      .eq('id', form.id)
      .select('id, status, is_published')

    if (error || !updated || updated.length === 0) {
      toast.error('Falha ao atualizar status')
      console.error('Publish update failed:', error, 'rows:', updated)
    } else {
      setForm(prev => ({ ...prev, status: newStatus }))
      toast.success(newStatus === 'published' ? 'Formulário publicado!' : 'Formulário despublicado')
      setShowPublishDialog(false)
      setHasUnsavedChanges(false)
    }
    setIsSaving(false)
  }

  const addQuestion = (type: QuestionConfig['type']) => {
    const newQuestion = createDefaultQuestion(type)
    setQuestions([...questions, newQuestion])
    setSelectedQuestionId(newQuestion.id)
    setShowAddQuestion(false)
    setHasUnsavedChanges(true)
  }

  const updateQuestion = (id: string, updates: Partial<QuestionConfig>) => {
    setQuestions(questions.map(q => 
      q.id === id ? { ...q, ...updates } : q
    ))
    setHasUnsavedChanges(true)
  }

  const deleteQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id))
    if (selectedQuestionId === id) {
      setSelectedQuestionId(null)
    }
    setHasUnsavedChanges(true)
  }

  const duplicateQuestion = (id: string) => {
    const idx = questions.findIndex(q => q.id === id)
    if (idx === -1) return
    const source = questions[idx]
    const clone: QuestionConfig = { ...source, id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()) }
    const newQuestions = [...questions]
    newQuestions.splice(idx + 1, 0, clone)
    setQuestions(newQuestions)
    setSelectedQuestionId(clone.id)
    setHasUnsavedChanges(true)
  }

  const handleReorder = (newOrder: QuestionConfig[]) => {
    setQuestions(newOrder)
    setHasUnsavedChanges(true)
  }

  const copyFormLink = () => {
    const link = `${window.location.origin}/f/${form.slug}`
    navigator.clipboard.writeText(link)
    toast.success('Link copiado!')
  }

  const currentTheme = themes[form.theme as ThemePreset] || themes.minimal

  return (
    <>
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="min-h-16 bg-white border-b border-slate-200 flex flex-wrap gap-2 items-center justify-between px-3 sm:px-4 py-2 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-6" />
          <div className="group relative flex items-center">
            <Input
              value={form.title}
              onChange={(e) => {
                setForm({ ...form, title: e.target.value })
                setHasUnsavedChanges(true)
              }}
              className="text-lg font-semibold border-0 border-b-2 border-transparent bg-transparent rounded-none focus-visible:ring-0 focus-visible:border-blue-500 hover:border-slate-300 px-1 pr-7 max-w-[140px] sm:max-w-xs transition-colors"
              placeholder="Formulário sem título"
            />
            <Pencil className="w-3.5 h-3.5 text-slate-400 absolute right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-0 transition-opacity pointer-events-none" />
          </div>
          {form.status === 'published' && (
            <Badge className="bg-emerald-100 text-emerald-700">Publicado</Badge>
          )}
          {form.status === 'draft' && (
            <Badge variant="secondary">Rascunho</Badge>
          )}
          {form.status === 'closed' && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700">Encerrado</Badge>
          )}
          {hasUnsavedChanges && (
            <span className="text-sm text-slate-500">Alterações não salvas</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {form.status === 'published' && (
            <>
              <Button variant="outline" size="sm" onClick={copyFormLink} className="hidden md:flex">
                <Copy className="w-4 h-4 mr-2" />
                Copiar link
              </Button>
              <Link href={`/f/${form.slug}`} target="_blank" className="hidden md:flex">
                <Button variant="outline" size="sm">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ver
                </Button>
              </Link>
            </>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save className="w-4 h-4 mr-2" />
            Salvar
          </Button>
          <Button
            size="sm"
            variant={null as never}
            onClick={() => setShowPublishDialog(true)}
            data-testid="publish-button"
            className={form.status === 'published' 
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 ring-2 ring-emerald-400/30' 
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20'
            }
          >
            <Globe className="w-4 h-4 mr-2" />
            {form.status === 'published' ? 'Publicado ✓' : 'Publicar'}
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden pb-14 md:pb-0">
        {/* Sidebar */}
        <aside className={`${mobilePanel === 'questions' ? 'flex' : 'hidden'} md:flex w-full md:w-80 bg-white border-r border-slate-200 flex-col shrink-0 overflow-hidden`}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col overflow-hidden">
            <div className="shrink-0 p-2 border-b border-slate-100">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="questions" className="text-xs">
                  <FileText className="w-3 h-3 mr-1" />
                  Perguntas
                </TabsTrigger>
                <TabsTrigger value="design" className="text-xs">
                  <Palette className="w-3 h-3 mr-1" />
                  Design
                </TabsTrigger>
                <TabsTrigger value="settings" className="text-xs px-1">
                  <Settings className="w-3 h-3 mr-0.5 shrink-0" />
                  <span className="truncate">Configurações</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="questions" className="flex-1 flex flex-col mt-0 overflow-hidden data-[state=inactive]:hidden">
              <div className="shrink-0 p-4 border-b border-slate-100">
                <Button 
                  onClick={() => setShowAddQuestion(true)}
                  className="w-full bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Pergunta
                </Button>
              </div>
              
              <ScrollArea className="flex-1">
                <div className="p-2">
                  {questions.length === 0 ? (
                    <div className="text-center py-8 px-4">
                      <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                      <p className="text-sm text-slate-500">Nenhuma pergunta ainda</p>
                      <p className="text-xs text-slate-500 mt-1">Adicione sua primeira pergunta para começar</p>
                    </div>
                  ) : (
                    <Reorder.Group axis="y" values={questions} onReorder={handleReorder}>
                      <AnimatePresence>
                        {questions.map((question, index) => (
                          <Reorder.Item key={question.id} value={question}>
                            <motion.div
                              layout
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className={`
                                group p-3 rounded-lg cursor-pointer mb-2 border transition-all
                                ${selectedQuestionId === question.id 
                                  ? 'bg-blue-50 border-blue-200' 
                                  : 'bg-white border-slate-100 hover:border-slate-200'
                                }
                              `}
                              onClick={() => { setSelectedQuestionId(question.id); setMobilePanel('editor'); }}
                            >
                              <div className="flex items-start gap-2">
                                <div className="mt-0 cursor-grab active:cursor-grabbing p-2 -m-2">
                                  <GripVertical className="w-5 h-5 text-slate-300" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-slate-600">
                                      {index + 1}
                                    </span>
                                    <span className="text-xs text-slate-600">
                                      {getQuestionTypeInfo(question.type)?.label || question.type}
                                    </span>
                                    {question.required && (
                                      <span className="text-xs text-red-500">*</span>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium text-slate-900 truncate">
                                    {question.title || 'Pergunta sem título'}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                                  title="Duplicar pergunta"
                                  data-testid="duplicate-question"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    duplicateQuestion(question.id)
                                  }}
                                >
                                  <Copy className="w-4 h-4 text-slate-400 hover:text-blue-500" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteQuestion(question.id)
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                                </Button>
                              </div>
                            </motion.div>
                          </Reorder.Item>
                        ))}
                      </AnimatePresence>
                    </Reorder.Group>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="design" className="flex-1 mt-0 overflow-auto data-[state=inactive]:hidden">
              <div className="p-4 space-y-6">
                <div>
                  <Label className="text-sm font-medium mb-3 block">Tema</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {themeList.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => {
                          setForm({ ...form, theme: theme.id })
                          setHasUnsavedChanges(true)
                        }}
                        className={`
                          p-3 rounded-lg border-2 transition-all text-left
                          ${form.theme === theme.id 
                            ? 'border-blue-500 ring-2 ring-blue-200' 
                            : 'border-slate-200 hover:border-slate-300'
                          }
                        `}
                      >
                        <div 
                          className="w-full h-8 rounded mb-2"
                          style={{ backgroundColor: theme.backgroundColor }}
                        >
                          <div 
                            className="w-1/2 h-full rounded-l flex items-center justify-center"
                            style={{ backgroundColor: theme.primaryColor }}
                          />
                        </div>
                        <span className="text-xs font-medium text-slate-700">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 mt-0 overflow-auto data-[state=inactive]:hidden">
              <div className="p-4 space-y-6">
                <div>
                  <Label htmlFor="slug" className="text-sm font-medium text-slate-700">URL do Formulário</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">/f/</span>
                    <Input
                      id="slug"
                      value={form.slug}
                      onChange={(e) => {
                        const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                        setForm({ ...form, slug })
                        setHasUnsavedChanges(true)
                      }}
                      className="flex-1 text-slate-900 placeholder:text-slate-400"
                      placeholder="meu-formulario"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="description" className="text-sm font-medium text-slate-700">Descrição</Label>
                  <Textarea
                    id="description"
                    value={form.description || ''}
                    onChange={(e) => {
                      setForm({ ...form, description: e.target.value })
                      setHasUnsavedChanges(true)
                    }}
                    className="mt-2 text-slate-900 placeholder:text-slate-400"
                    placeholder="Descrição opcional..."
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="thank_you" className="text-sm font-medium text-slate-700">Mensagem de Agradecimento</Label>
                  <Textarea
                    id="thank_you"
                    value={form.thank_you_message}
                    onChange={(e) => {
                      setForm({ ...form, thank_you_message: e.target.value })
                      setHasUnsavedChanges(true)
                    }}
                    className="mt-2 text-slate-900 placeholder:text-slate-400"
                    placeholder="Obrigado pela sua resposta!"
                    rows={3}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Tela de Agradecimento</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Título</Label>
                    <Input
                      value={form.thank_you_title || ''}
                      onChange={(e) => {
                        setForm({ ...form, thank_you_title: e.target.value || null })
                        setHasUnsavedChanges(true)
                      }}
                      className="mt-2 text-slate-900 placeholder:text-slate-400"
                      placeholder="Obrigado! 🎉"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Mensagem</Label>
                    <Textarea
                      value={form.thank_you_description || ''}
                      onChange={(e) => {
                        setForm({ ...form, thank_you_description: e.target.value || null })
                        setHasUnsavedChanges(true)
                      }}
                      className="mt-2 text-slate-900 placeholder:text-slate-400"
                      placeholder="Sua resposta foi registrada com sucesso."
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Botão (opcional)</Label>
                    <Input
                      value={form.thank_you_button_text || ''}
                      onChange={(e) => {
                        setForm({ ...form, thank_you_button_text: e.target.value || null })
                        setHasUnsavedChanges(true)
                      }}
                      className="mt-2 mb-2 text-slate-900 placeholder:text-slate-400"
                      placeholder="Ex: Voltar ao site"
                    />
                    <Input
                      value={form.thank_you_button_url || ''}
                      onChange={(e) => {
                        setForm({ ...form, thank_you_button_url: e.target.value || null })
                        setHasUnsavedChanges(true)
                      }}
                      className="text-slate-900 placeholder:text-slate-400"
                      placeholder="https://seusite.com.br"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="redirect_url" className="text-sm font-medium text-slate-700">
                    URL de Redirecionamento
                  </Label>
                  <p className="text-xs text-slate-500 mt-0.5">Após envio, redirecionar para esta URL</p>
                  <Input
                    id="redirect_url"
                    value={form.redirect_url || ''}
                    onChange={(e) => {
                      setForm({ ...form, redirect_url: e.target.value || null })
                      setHasUnsavedChanges(true)
                    }}
                    className="mt-2 text-slate-900 placeholder:text-slate-400"
                    placeholder="https://exemplo.com/obrigado"
                  />
                </div>

                <div>
                  <Label htmlFor="webhook_url" className="text-sm font-medium text-slate-700">
                    URL de Webhook
                  </Label>
                  <p className="text-xs text-slate-500 mt-0.5">Notificação POST enviada com os dados da resposta ao submeter</p>
                  <Input
                    id="webhook_url"
                    value={form.webhook_url || ''}
                    onChange={(e) => {
                      setForm({ ...form, webhook_url: e.target.value || null })
                      setHasUnsavedChanges(true)
                    }}
                    className="mt-2 text-slate-900 placeholder:text-slate-400"
                    placeholder="https://webhook.site/seu-endpoint"
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Pixels de Rastreamento</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="meta_pixel" className="text-sm font-medium text-slate-700">Meta Pixel ID</Label>
                      <Input
                        id="meta_pixel"
                        value={pixels.metaPixelId || ''}
                        onChange={(e) => {
                          setPixels({ ...pixels, metaPixelId: e.target.value || undefined })
                          setHasUnsavedChanges(true)
                        }}
                        className="mt-1.5 text-slate-900 placeholder:text-slate-400"
                        placeholder="123456789012345"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="google_ads_id" className="text-sm font-medium text-slate-700">Google Ads ID</Label>
                        <Input
                          id="google_ads_id"
                          value={pixels.googleAdsId || ''}
                          onChange={(e) => {
                            setPixels({ ...pixels, googleAdsId: e.target.value || undefined })
                            setHasUnsavedChanges(true)
                          }}
                          className="mt-1.5 text-slate-900 placeholder:text-slate-400"
                          placeholder="AW-XXXXXXXXX"
                        />
                      </div>
                      <div>
                        <Label htmlFor="google_ads_label" className="text-sm font-medium text-slate-700">Rótulo de Conversão</Label>
                        <Input
                          id="google_ads_label"
                          value={pixels.googleAdsLabel || ''}
                          onChange={(e) => {
                            setPixels({ ...pixels, googleAdsLabel: e.target.value || undefined })
                            setHasUnsavedChanges(true)
                          }}
                          className="mt-1.5 text-slate-900 placeholder:text-slate-400"
                          placeholder="AbCdEfGhIj"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="tiktok_pixel" className="text-sm font-medium text-slate-700">TikTok Pixel ID</Label>
                      <Input
                        id="tiktok_pixel"
                        value={pixels.tiktokPixelId || ''}
                        onChange={(e) => {
                          setPixels({ ...pixels, tiktokPixelId: e.target.value || undefined })
                          setHasUnsavedChanges(true)
                        }}
                        className="mt-1.5 text-slate-900 placeholder:text-slate-400"
                        placeholder="CXXXXXXXXXXXXXXXXX"
                      />
                    </div>
                    <div>
                      <Label htmlFor="gtm_id" className="text-sm font-medium text-slate-700">Google Tag Manager ID</Label>
                      <Input
                        id="gtm_id"
                        value={pixels.gtmId || ''}
                        onChange={(e) => {
                          setPixels({ ...pixels, gtmId: e.target.value || undefined })
                          setHasUnsavedChanges(true)
                        }}
                        className="mt-1.5 text-slate-900 placeholder:text-slate-400"
                        placeholder="GTM-XXXXXXX"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </aside>

        {/* Preview / Editor area */}
        <div className={`${mobilePanel !== 'questions' ? 'flex' : 'hidden'} md:flex flex-1 overflow-hidden`}>
          {/* Question Editor */}
          {selectedQuestion && (
            <div className={`${mobilePanel === 'editor' ? 'flex flex-col' : 'hidden'} md:flex md:flex-col flex-1 min-w-0 bg-white border-r border-slate-200 overflow-auto`}>
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-medium">Editar Pergunta</h3>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setSelectedQuestionId(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <QuestionEditor
                question={selectedQuestion}
                allQuestions={questions}
                onUpdate={(updates) => updateQuestion(selectedQuestion.id, updates)}
                onDelete={() => deleteQuestion(selectedQuestion.id)}
                onDuplicate={() => duplicateQuestion(selectedQuestion.id)}
              />
            </div>
          )}

          {/* Preview */}
          <div className={`${mobilePanel === 'preview' || !selectedQuestion ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0 overflow-auto bg-slate-100 p-4 md:p-8`}>
            <div className="max-w-2xl mx-auto">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mb-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
                  <Eye className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-600">Visualização</span>
                </div>
                <div 
                  className="min-h-[500px]"
                  style={{ 
                    backgroundColor: currentTheme.backgroundColor,
                    fontFamily: currentTheme.fontFamily 
                  }}
                >
                  <FormPreview 
                    questions={questions}
                    theme={currentTheme}
                    selectedQuestionId={selectedQuestionId}
                    onSelectQuestion={setSelectedQuestionId}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-50">
        <button
          onClick={() => setMobilePanel('questions')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: mobilePanel === 'questions' ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          Perguntas
        </button>
        <button
          onClick={() => setMobilePanel('editor')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: mobilePanel === 'editor' ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          Editar
        </button>
        <button
          onClick={() => setMobilePanel('preview')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: mobilePanel === 'preview' ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Preview
        </button>
      </div>

      {/* Add Question Dialog */}
      <Dialog open={showAddQuestion} onOpenChange={setShowAddQuestion}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Adicionar Pergunta</DialogTitle>
            <DialogDescription>
              Escolha o tipo de pergunta para adicionar
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-4 overflow-y-auto max-h-[60vh] pr-1">
            {questionTypes.map((qt) => (
              <button
                key={qt.type}
                onClick={() => addQuestion(qt.type)}
                className="p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
              >
                <qt.icon className="w-6 h-6 text-slate-400 group-hover:text-blue-600 mb-2" />
                <p className="font-medium text-sm text-slate-900">{qt.label}</p>
                <p className="text-xs text-slate-500 mt-1">{qt.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.status === 'published' ? 'Despublicar formulário?' : 'Publicar formulário?'}
            </DialogTitle>
            <DialogDescription>
              {form.status === 'published' 
                ? 'Isso tornará seu formulário inacessível. As respostas existentes serão mantidas.'
                : 'Seu formulário ficará acessível em:'
              }
            </DialogDescription>
          </DialogHeader>
          {form.status !== 'published' && (
            <div className="p-3 bg-slate-50 rounded-lg">
              <code className="text-sm text-blue-600">
                {typeof window !== 'undefined' ? window.location.origin : ''}/f/{form.slug}
              </code>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublishDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handlePublish}
              disabled={isSaving}
              className={form.status === 'published' 
                ? 'bg-amber-500 hover:bg-amber-600' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20'
              }
            >
              {isSaving ? 'Salvando...' : form.status === 'published' ? 'Despublicar' : 'Publicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  )
}
