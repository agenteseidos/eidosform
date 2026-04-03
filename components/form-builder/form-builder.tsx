'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Form, QuestionConfig, ThemePreset, FormStatus } from '@/lib/database.types'
import { questionTypes, createDefaultQuestion, getQuestionTypeInfo } from '@/lib/questions'
import { themes, themeList } from '@/lib/themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
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

  Globe,
  RefreshCw,
  Copy,
  Settings,
  Palette,
  FileText,
  Pencil,
  Upload,
  Loader2,
  Type,
  AlignLeft,
  Mail,
  Phone,
  Hash,
  ToggleLeft,
  List,
  Star,
  Calendar,
  Gauge,
  CheckSquare,
  Link as LinkIcon,
  MapPin,
  Fingerprint,
  LucideIcon,
  CalendarClock,
  BarChart3,
  Share2,
  HandMetal,
  PartyPopper,
  Zap,
  MessageCircle,
  Table,
  Crosshair,
  Database,
  Bell,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Unlink,
  Lock,
  TextCursorInput,
} from 'lucide-react'
import Link from 'next/link'
import { FormPreview } from './form-preview'
import { RightPanel } from './right-panel'
import { getContentBlockPreview } from '@/lib/content-block'

// B03: Mapeamento de tipo de campo → ícone + cor para sidebar
const questionTypeVisuals: Record<string, { icon: LucideIcon; color: string }> = {
  short_text:    { icon: Type,        color: 'text-slate-500' },
  long_text:     { icon: AlignLeft,   color: 'text-slate-500' },
  email:         { icon: Mail,        color: 'text-blue-500' },
  phone:         { icon: Phone,       color: 'text-green-500' },
  number:        { icon: Hash,        color: 'text-orange-500' },
  yes_no:        { icon: ToggleLeft,  color: 'text-purple-500' },
  dropdown:      { icon: List,        color: 'text-yellow-600' },
  checkboxes:    { icon: CheckSquare, color: 'text-yellow-600' },
  nps:           { icon: Star,        color: 'text-amber-500' },
  opinion_scale: { icon: Gauge,       color: 'text-amber-500' },
  rating:        { icon: Star,        color: 'text-amber-500' },
  date:          { icon: Calendar,    color: 'text-teal-500' },
  file_upload:   { icon: Upload,      color: 'text-pink-500' },
  url:           { icon: LinkIcon,    color: 'text-blue-400' },
  address:       { icon: MapPin,      color: 'text-emerald-500' },
  cpf:           { icon: Fingerprint, color: 'text-violet-500' },
  calendly:      { icon: CalendarClock, color: 'text-cyan-500' },
  content_block: { icon: TextCursorInput, color: 'text-indigo-500' },
}

function getQuestionVisual(type: string) {
  return questionTypeVisuals[type] || { icon: FileText, color: 'text-slate-400' }
}

interface UserInfo {
  email: string
  name: string
  avatarUrl: string
}

interface FormBuilderProps {
  form: Form
  userPlan?: string
  userInfo?: UserInfo
}

export function FormBuilder({ form: initialForm, userPlan = 'free', userInfo }: FormBuilderProps) {
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
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sidebarSection, setSidebarSection] = useState<'welcome' | 'questions' | 'thankyou' | null>(null)
  const [previewMode, setPreviewMode] = useState<"full" | "step">("full")
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsTitle, setSheetsTitle] = useState('')
  const [stepPreviewIndex, setStepPreviewIndex] = useState(0)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedQuestion = questions.find(q => q.id === selectedQuestionId)
  const isMobileUtilityTab = activeTab === 'integrations' || activeTab === 'share'
  const shouldShowMobileSidebar = mobilePanel === 'questions' || isMobileUtilityTab
  const shouldShowMobilePreview = !isMobileUtilityTab && (mobilePanel === 'preview' || mobilePanel === 'editor')
  const shouldShowMobileRightPanel = !isMobileUtilityTab && mobilePanel === 'editor'

  useEffect(() => {
    if (previewMode !== 'step') return

    const selectedIndex = questions.findIndex(q => q.id === selectedQuestionId)
    if (selectedIndex >= 0 && selectedIndex !== stepPreviewIndex) {
      setStepPreviewIndex(selectedIndex)
    }
  }, [previewMode, questions, selectedQuestionId, stepPreviewIndex])

  useEffect(() => {
    setStepPreviewIndex((currentIndex) => {
      if (questions.length === 0) return 0
      return Math.min(currentIndex, questions.length - 1)
    })
  }, [questions])

  useEffect(() => {
    if (previewMode !== 'step') return

    const previewQuestion = questions[stepPreviewIndex]
    if (previewQuestion && previewQuestion.id !== selectedQuestionId) {
      setSelectedQuestionId(previewQuestion.id)
      setSidebarSection(null)
    }
  }, [previewMode, questions, stepPreviewIndex, selectedQuestionId])

  useEffect(() => {
    if (activeTab === 'integrations' || activeTab === 'share') {
      setMobilePanel('questions')
    }
  }, [activeTab])

  // Warn user about unsaved changes when leaving the page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        // Modern browsers ignore custom messages but still show the prompt
        e.returnValue = 'Você tem alterações não salvas. Deseja sair?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // B06: Autosave com debounce de 1500ms
  const handleAutosave = useCallback(async () => {
    setSaveStatus('saving')
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
      pixel_event_on_start: form.pixel_event_on_start || null,
      pixel_event_on_complete: form.pixel_event_on_complete || null,
      welcome_enabled: form.welcome_enabled || false,
      welcome_title: form.welcome_title || null,
      welcome_description: form.welcome_description || null,
      welcome_button_text: form.welcome_button_text || null,
      welcome_image_url: form.welcome_image_url || null,
      is_closed: form.is_closed ?? false,
      hide_branding: form.hide_branding ?? false,
      notify_email_enabled: form.notify_email_enabled ?? false,
      notify_email: form.notify_email || null,
      notify_whatsapp_enabled: form.notify_whatsapp_enabled ?? false,
      notify_whatsapp_number: form.notify_whatsapp_number || null,
      google_sheets_enabled: form.google_sheets_enabled ?? false,
      google_sheets_id: form.google_sheets_id || null,
      google_sheets_share_email: form.google_sheets_share_email || null,
    }
    try {
      // Use API route when Google Sheets creation is needed (API handles spreadsheet creation)
      const needsSheetsCreation = updateData.google_sheets_enabled && !updateData.google_sheets_id
      if (needsSheetsCreation) {
        const response = await fetch(`/api/forms/${form.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        })
        const data = await response.json().catch(() => null)
        if (response.ok && data?.form) {
          setForm(data.form)
          setHasUnsavedChanges(false)
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } else {
          const errorMsg = data?.error || 'Falha ao salvar'
          toast.error(errorMsg)
          setSaveStatus('idle')
        }
      } else {
        const { error } = await supabase
          .from('forms')
          .update(updateData)
          .eq('id', form.id)
        if (!error) {
          setHasUnsavedChanges(false)
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } else {
          setSaveStatus('idle')
        }
      }
    } catch {
      setSaveStatus('idle')
    } finally {
      setIsSaving(false)
    }
  }, [supabase, form, questions, pixels])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      handleAutosave()
    }, 1500)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [hasUnsavedChanges, handleAutosave])

  const handleWelcomeImageUpload = useCallback(async (file: File) => {
    if (!file) return
    const allowedTypes = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Formato não suportado. Use SVG, PNG, JPG ou GIF.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 2MB.')
      return
    }
    setIsUploadingImage(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const filename = `${Date.now()}.${ext}`
      const path = `welcome/${form.id}/${filename}`
      const { error } = await supabase.storage.from('form-images').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('form-images').getPublicUrl(path)
      setForm(prev => ({ ...prev, welcome_image_url: publicUrl }))
      setHasUnsavedChanges(true)
      toast.success('Imagem enviada com sucesso!')
    } catch (err) {
      console.error(err)
      toast.error('Erro ao enviar imagem.')
    } finally {
      setIsUploadingImage(false)
    }
  }, [form.id, supabase, setForm, setHasUnsavedChanges])

  const handleRemoveWelcomeImage = useCallback(async () => {
    setForm(prev => ({ ...prev, welcome_image_url: null }))
    setHasUnsavedChanges(true)
  }, [setForm, setHasUnsavedChanges])

  const buildFormPayload = useCallback((status?: FormStatus) => ({
    title: form.title,
    description: form.description,
    slug: form.slug,
    theme: form.theme,
    questions,
    thank_you_message: form.thank_you_message,
    thank_you_title: form.thank_you_title || null,
    thank_you_description: form.thank_you_description || null,
    thank_you_button_text: form.thank_you_button_text || null,
    thank_you_button_url: form.thank_you_button_url || null,
    pixels,
    redirect_url: form.redirect_url || null,
    webhook_url: form.webhook_url || null,
    pixel_event_on_start: form.pixel_event_on_start || null,
    pixel_event_on_complete: form.pixel_event_on_complete || null,
    welcome_enabled: form.welcome_enabled || false,
    welcome_title: form.welcome_title || null,
    welcome_description: form.welcome_description || null,
    welcome_button_text: form.welcome_button_text || null,
    welcome_image_url: form.welcome_image_url || null,
    is_closed: form.is_closed ?? false,
    hide_branding: form.hide_branding ?? false,
    notify_email_enabled: form.notify_email_enabled ?? false,
    notify_email: form.notify_email || null,
    notify_whatsapp_enabled: form.notify_whatsapp_enabled ?? false,
    notify_whatsapp_number: form.notify_whatsapp_number || null,
    google_sheets_enabled: form.google_sheets_enabled ?? false,
    google_sheets_id: form.google_sheets_id || null,
    google_sheets_share_email: form.google_sheets_share_email || null,
    ...(status && { status }),
  }), [form, questions, pixels])

  const updateFormViaApi = useCallback(async (payload: ReturnType<typeof buildFormPayload>) => {
    const response = await fetch(`/api/forms/${form.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(data?.error || 'Falha ao atualizar formulário')
    }

    return data?.form as Form | undefined
  }, [form.id])

  const handleSave = useCallback(async () => {
    setIsSaving(true)

    try {
      const updatedForm = await updateFormViaApi(buildFormPayload())
      if (updatedForm) setForm(updatedForm)
      toast.success('Formulário salvo')
      setHasUnsavedChanges(false)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar formulário')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [buildFormPayload, updateFormViaApi])

  const handlePublish = async () => {
    if (questions.length === 0) {
      toast.error('Adicione ao menos uma pergunta antes de publicar')
      return
    }

    setIsSaving(true)
    try {
      const payload = { ...buildFormPayload(), status: 'published' as FormStatus, is_published: true }
      await updateFormViaApi(payload)
      setForm(prev => ({ ...prev, status: 'published' as FormStatus }))
      toast.success(form.status === 'published' ? 'Alterações publicadas!' : 'Formulário publicado!')
      setShowPublishDialog(false)
      setHasUnsavedChanges(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao atualizar status')
    } finally {
      setIsSaving(false)
    }
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
      <header className="min-h-14 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0 overflow-hidden">
          {/* Left: Voltar + título */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden basis-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (hasUnsavedChanges) {
                  setShowLeaveDialog(true)
                } else {
                  router.push('/dashboard')
                }
              }}
              className="shrink-0"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
            <Separator orientation="vertical" className="h-6 hidden sm:block" />
            <div className="group relative flex items-center min-w-0 flex-1 max-w-full overflow-hidden">
              <Input
                value={form.title}
                onChange={(e) => {
                  setForm({ ...form, title: e.target.value })
                  setHasUnsavedChanges(true)
                }}
                className="w-full min-w-0 max-w-[140px] sm:max-w-[220px] truncate text-sm sm:text-base font-semibold border-0 border-b-2 border-transparent bg-transparent rounded-none focus-visible:ring-0 focus-visible:border-blue-500 hover:border-slate-300 px-1 pr-7 transition-colors"
                placeholder="Sem título"
              />
              <Pencil className="w-3.5 h-3.5 text-slate-400 absolute right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-0 transition-opacity pointer-events-none" />
            </div>
          </div>

          {/* Center: Tabs de navegação */}
          <nav className="hidden md:flex items-center bg-slate-100 rounded-lg p-1 gap-0.5">
            {[
              { id: 'edit', label: 'Editar', icon: Pencil, activeTabs: ['questions', 'design', 'config'], defaultTab: 'questions' },
              { id: 'integrations', label: 'Integrações', icon: Zap, activeTabs: ['integrations'], defaultTab: 'integrations' },
              { id: 'share', label: 'Compartilhar', icon: Share2, activeTabs: ['share'], defaultTab: 'share' },
              { id: 'results', label: 'Resultados', icon: BarChart3, activeTabs: [] as string[], defaultTab: null as string | null },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'results') {
                    router.push(`/dashboard/forms/${form.id}/responses`)
                  } else {
                    setActiveTab(tab.defaultTab!)
                  }
                }}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${tab.activeTabs.includes(activeTab)
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                  }
                `}
              >
                <tab.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Right: Upgrade + Save status + Publish */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-2 flex-1 basis-0">
            {/* B10: Botão Upgrade para todos abaixo de Professional */}
            {(userPlan === 'free' || userPlan === 'starter' || userPlan === 'plus') && (
              <Link
                href="/billing"
                className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 hover:from-amber-500 hover:to-yellow-600 transition-all shadow-sm hover:shadow-md"
              >
                <Zap className="w-3.5 h-3.5" />
                Upgrade
              </Link>
            )}
            {/* B06: Autosave status indicator */}
            <span className="text-xs text-slate-400 hidden sm:flex items-center gap-1 min-w-[70px] justify-end">
              {saveStatus === 'saving' && (
                <><Loader2 className="w-3 h-3 animate-spin" /> Salvando...</>
              )}
              {saveStatus === 'saved' && (
                <span className="text-emerald-500">Salvo ✓</span>
              )}
            </span>

            {/* B11: Status badge separado da ação de publicar */}
            {form.status === 'published' && (
              <Badge variant="outline" className="hidden sm:flex items-center gap-1.5 border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-medium px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Publicado
              </Badge>
            )}
            {form.status === 'draft' && (
              <Badge variant="outline" className="hidden sm:flex items-center gap-1 border-slate-300 bg-slate-50 text-slate-500 text-xs font-medium px-2.5 py-1">
                Rascunho
              </Badge>
            )}

            {/* B11: Botão Publicar como CTA primário — sempre ação, nunca estado */}
            <Button
              size="sm"
              onClick={() => setShowPublishDialog(true)}
              data-testid="publish-button"
              className={
                form.status === 'published' && hasUnsavedChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 ring-2 ring-blue-400/30 font-semibold px-5 animate-pulse'
                  : form.status === 'published'
                    ? 'bg-slate-600 hover:bg-slate-700 text-white font-semibold px-5'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 font-semibold px-5'
              }
            >
              {form.status === 'published' && hasUnsavedChanges ? (
                <RefreshCw className="w-4 h-4 mr-1.5" />
              ) : (
                <Globe className="w-4 h-4 mr-1.5" />
              )}
              <span className="hidden sm:inline">Publicar</span>
            </Button>

            {/* B20: Avatar do usuário no header */}
            {userInfo && (
              <div
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full shrink-0 overflow-hidden border-2 border-slate-200"
                title={userInfo.name || userInfo.email}
              >
                {userInfo.avatarUrl ? (
                  <img
                    src={userInfo.avatarUrl}
                    alt={userInfo.name || 'Avatar'}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 w-full h-full flex items-center justify-center">
                    {(userInfo.name || userInfo.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden pb-14 md:pb-0">
        {/* Sidebar */}
        <aside className={`${shouldShowMobileSidebar ? 'flex' : 'hidden'} md:flex w-full md:w-80 md:min-w-[280px] bg-white border-r border-slate-200 flex-col shrink-0 overflow-hidden`}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col overflow-hidden">
            {/* Mobile-only: main section selector */}
            <div className="shrink-0 p-2 border-b border-slate-100 md:hidden">
              <div className="grid w-full grid-cols-3 bg-slate-100 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => {
                    if (!['questions', 'design', 'config'].includes(activeTab)) setActiveTab('questions')
                    setMobilePanel('questions')
                  }}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    ['questions', 'design', 'config'].includes(activeTab)
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  Editar
                </button>
                <button
                  onClick={() => {
                    setActiveTab('integrations')
                    setMobilePanel('questions')
                  }}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeTab === 'integrations'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  <Zap className="w-3 h-3" />
                  Integr.
                </button>
                <button
                  onClick={() => {
                    setActiveTab('share')
                    setMobilePanel('questions')
                  }}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeTab === 'share'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  <Share2 className="w-3 h-3" />
                  Comp.
                </button>
              </div>
            </div>

            {/* Sub-tabs for Editar section — shown on both mobile and desktop */}
            {['questions', 'design', 'config'].includes(activeTab) && (
              <div className="shrink-0 px-2 pb-2 pt-1 border-b border-slate-100">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="questions" className="text-xs">
                    <FileText className="w-3 h-3 mr-1" />
                    Perguntas
                  </TabsTrigger>
                  <TabsTrigger value="design" className="text-xs">
                    <Palette className="w-3 h-3 mr-1" />
                    Design
                  </TabsTrigger>
                  <TabsTrigger value="config" className="text-xs px-1.5" title="Configurações">
                    <Settings className="w-3 h-3 mr-1 shrink-0" />
                    <span className="whitespace-nowrap">Config</span>
                  </TabsTrigger>
                </TabsList>
              </div>
            )}

            <TabsContent value="questions" className="flex-1 flex flex-col mt-0 overflow-hidden data-[state=inactive]:hidden">
              <div className="flex-1 min-h-0 p-2 space-y-1 flex flex-col">

                {/* === SEÇÃO: TELA DE BOAS VINDAS === */}
                <div className="px-2 pt-3 pb-1 shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tela de Boas Vindas</span>
                </div>
                <button
                  onClick={() => {
                    setSidebarSection('welcome')
                    setSelectedQuestionId(null)
                    setMobilePanel('editor')
                  }}
                  className={`
                    w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left shrink-0
                    ${sidebarSection === 'welcome' && !selectedQuestionId
                      ? 'bg-blue-50/70 border-blue-500 border-l-4 border-l-blue-500 ring-1 ring-blue-200 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 border-l-4 border-l-transparent'
                    }
                  `}
                >
                  <HandMetal className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 line-clamp-2">
                      {form.welcome_title || form.title || 'Tela de boas vindas'}
                    </p>
                    <p className="text-xs text-slate-400">{form.welcome_enabled ? 'Ativada' : 'Desativada'}</p>
                  </div>
                </button>

                {/* === SEÇÃO: QUESTÕES === */}
                <div className="px-2 pt-4 pb-1 flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Questões</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddQuestion(true)}
                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Adicionar
                  </Button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  {questions.length === 0 ? (
                    <div className="text-center py-6 px-4">
                      <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm text-slate-500">Nenhuma pergunta ainda</p>
                      <p className="text-xs text-slate-400 mt-1">Clique em Adicionar para começar</p>
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
                                group p-3 rounded-lg cursor-pointer mb-2 border-l-4 border transition-all
                                ${selectedQuestionId === question.id 
                                  ? 'bg-blue-50/70 border-blue-500 border-l-blue-500 ring-1 ring-blue-200 shadow-sm' 
                                  : 'bg-white border-slate-100 border-l-transparent hover:border-slate-200 hover:border-l-slate-300'
                                }
                              `}
                              onClick={() => { setSelectedQuestionId(question.id); setSidebarSection(null); setMobilePanel('editor'); }}
                            >
                              <div className="flex items-start gap-2">
                                <div className="mt-0 cursor-grab active:cursor-grabbing p-2 -m-2">
                                  <GripVertical className="w-5 h-5 text-slate-300" />
                                </div>
                                {(() => {
                                  const visual = getQuestionVisual(question.type)
                                  const IconComp = visual.icon
                                  return <IconComp className={`w-4 h-4 mt-0.5 shrink-0 ${visual.color}`} />
                                })()}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-slate-600">
                                      {index + 1}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                      {getQuestionTypeInfo(question.type)?.label || question.type}
                                    </span>
                                    {question.required && (
                                      <span className="text-xs text-red-500">*</span>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium text-slate-900 line-clamp-2">
                                    {question.type === 'content_block'
                                      ? getContentBlockPreview(question.contentBody || question.title || '')
                                      : (question.title || 'Pergunta sem título')}
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

                  {/* B19: Botão inline adicionar pergunta */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-2 mb-1"
                  >
                    <button
                      onClick={() => setShowAddQuestion(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar pergunta
                    </button>
                  </motion.div>
                </div>

                {/* === SEÇÃO: TELAS FINAIS === */}
                <div className="px-2 pt-4 pb-1 shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Telas Finais</span>
                </div>
                <button
                  onClick={() => {
                    setSidebarSection('thankyou')
                    setSelectedQuestionId(null)
                    setMobilePanel('editor')
                  }}
                  className={`
                    w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left
                    ${sidebarSection === 'thankyou' && !selectedQuestionId
                      ? 'bg-blue-50/70 border-blue-500 border-l-4 border-l-blue-500 ring-1 ring-blue-200 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 border-l-4 border-l-transparent'
                    }
                  `}
                >
                  <PartyPopper className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 line-clamp-2">
                      {form.thank_you_title || 'Tela de agradecimento'}
                    </p>
                    <p className="text-xs text-slate-400">Padrão</p>
                  </div>
                </button>

              </div>
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

            <TabsContent value="config" className="flex-1 mt-0 overflow-auto data-[state=inactive]:hidden">
              <div className="p-4 space-y-6">
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

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Acesso</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Fechar formulário</p>
                      <p className="text-xs text-slate-500 mt-0.5">Impede novos envios. Respostas existentes são mantidas.</p>
                    </div>
                    <Switch
                      checked={form.is_closed ?? false}
                      onCheckedChange={(checked) => {
                        setForm({ ...form, is_closed: checked })
                        setHasUnsavedChanges(true)
                      }}
                    />
                  </div>
                  {userPlan === 'plus' || userPlan === 'professional' ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white mt-3">
                      <div>
                        <p className="text-sm font-medium text-slate-700">Ocultar &quot;Feito com EidosForm&quot;</p>
                        <p className="text-xs text-slate-500 mt-0.5">Remove o branding do rodapé do formulário.</p>
                      </div>
                      <Switch
                        checked={form.hide_branding ?? false}
                        onCheckedChange={(checked) => {
                          setForm({ ...form, hide_branding: checked })
                          setHasUnsavedChanges(true)
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50 mt-3 opacity-70">
                      <div>
                        <p className="text-sm font-medium text-slate-500">Ocultar &quot;Feito com EidosForm&quot;</p>
                        <p className="text-xs text-slate-400 mt-0.5">Remove o branding do rodapé do formulário.</p>
                        <a href="/billing" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Upgrade para Plus+ →</a>
                      </div>
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">Plus+</span>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="integrations" className="flex-1 mt-0 overflow-auto data-[state=inactive]:hidden">
              <div className="p-4 space-y-6">

                {/* ── Seção 1: Rastreamento ── */}
                <section>
                  <div className="flex items-center gap-2.5 mb-4">
                    <Crosshair className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Rastreamento</h3>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>

                  <div className="space-y-4">
                    {/* Meta Pixel — agrupado com Eventos */}
                    <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <Crosshair className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700">Meta Pixel</p>
                          <p className="text-xs text-slate-500">Rastreie conversões e eventos no Meta Ads.</p>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="meta_pixel" className="text-sm font-medium text-slate-700">Pixel ID</Label>
                        <Input
                          id="meta_pixel"
                          value={pixels.metaPixelId || ''}
                          onChange={(e) => {
                            setPixels({ ...pixels, metaPixelId: e.target.value || undefined })
                            setHasUnsavedChanges(true)
                          }}
                          className="mt-1.5 text-slate-900 placeholder:text-slate-400 bg-white"
                          placeholder="123456789012345"
                        />
                      </div>
                      {userPlan === 'plus' || userPlan === 'professional' ? (
                        <>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Eventos</p>
                          <div>
                            <Label htmlFor="pixel_event_start" className="text-sm font-medium text-slate-700">Evento ao iniciar</Label>
                            <Input
                              id="pixel_event_start"
                              value={form.pixel_event_on_start || ''}
                              onChange={(e) => {
                                setForm({ ...form, pixel_event_on_start: e.target.value || null })
                                setHasUnsavedChanges(true)
                              }}
                              className="mt-1.5 text-slate-900 placeholder:text-slate-400 bg-white"
                              placeholder="ex: FormStarted"
                            />
                          </div>
                          <div>
                            <Label htmlFor="pixel_event_complete" className="text-sm font-medium text-slate-700">Evento ao completar</Label>
                            <Input
                              id="pixel_event_complete"
                              value={form.pixel_event_on_complete || ''}
                              onChange={(e) => {
                                setForm({ ...form, pixel_event_on_complete: e.target.value || null })
                                setHasUnsavedChanges(true)
                              }}
                              className="mt-1.5 text-slate-900 placeholder:text-slate-400 bg-white"
                              placeholder="ex: Lead"
                            />
                          </div>
                          <p className="text-xs text-slate-400">Eventos disparados automaticamente via Pixel configurado acima.</p>
                        </>
                      ) : (
                        <div className="p-3 rounded-lg border border-slate-200 bg-white opacity-60">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-500">Eventos do Pixel</span>
                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Plus+</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">Disponível nos planos Plus e Professional.</p>
                          <a href="/billing" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Fazer upgrade →</a>
                        </div>
                      )}
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
                </section>

                {/* ── Seção 2: Destino de dados ── */}
                <section>
                  <div className="flex items-center gap-2.5 mb-4">
                    <Database className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Destino de dados</h3>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>

                  {/* Google Sheets */}
                  <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <Table className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">Google Sheets</p>
                        <p className="text-xs text-slate-500">Envie automaticamente as respostas para uma planilha do Google Sheets.</p>
                      </div>
                    </div>

                    {form.google_sheets_id ? (
                      <>
                        {/* CONNECTED state */}
                        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-medium text-emerald-700">Conectado</span>
                          </div>
                          <a
                            href={`https://docs.google.com/spreadsheets/d/${form.google_sheets_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {sheetsTitle || 'Abrir planilha'}
                          </a>
                          <p className="text-xs text-slate-500">Novas respostas serão enviadas automaticamente.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                toast.loading('Testando conexão...', { id: 'sheets-test' })
                                const res = await fetch(`/api/forms/${form.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    google_sheets_url: `https://docs.google.com/spreadsheets/d/${form.google_sheets_id}`,
                                  }),
                                })
                                if (!res.ok) {
                                  const data = await res.json().catch(() => ({}))
                                  throw new Error(data.error || 'Falha ao testar conexão')
                                }
                                toast.success('Conexão funcionando!', { id: 'sheets-test' })
                              } catch (err: unknown) {
                                const message = err instanceof Error ? err.message : 'Falha ao testar conexão'
                                toast.error(message, { id: 'sheets-test' })
                              }
                            }}
                            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 font-medium py-1.5 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Testar Conexão
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                toast.loading('Desconectando...', { id: 'sheets-disconnect' })
                                const res = await fetch(`/api/forms/${form.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    google_sheets_enabled: false,
                                    google_sheets_id: null,
                                  }),
                                })
                                if (!res.ok) throw new Error('Erro ao desconectar')
                                setForm({ ...form, google_sheets_enabled: false, google_sheets_id: null })
                                setSheetsTitle('')
                                setHasUnsavedChanges(false)
                                toast.success('Planilha desconectada', { id: 'sheets-disconnect' })
                              } catch {
                                toast.error('Erro ao desconectar planilha', { id: 'sheets-disconnect' })
                              }
                            }}
                            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-medium py-1.5 px-3 rounded-md border border-red-200 bg-white hover:bg-red-50 transition-colors ml-auto"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            Desconectar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* DISCONNECTED state */}
                        <div className="space-y-3">
                          <div className="p-3 rounded-md bg-white border border-slate-200 space-y-2">
                            <p className="text-xs text-slate-600">
                              1. Crie uma planilha em branco no Google Sheets
                            </p>
                            <p className="text-xs text-slate-600">
                              2. Compartilhe com o e-mail abaixo <span className="text-slate-400">(permissão de Editor)</span>:
                            </p>
                            <div className="flex items-center gap-2 p-2 rounded bg-slate-50 border border-slate-200">
                              <code className="text-xs text-slate-700 flex-1 break-all">
                                eidosform-sheets@eidosform.iam.gserviceaccount.com
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText('eidosform-sheets@eidosform.iam.gserviceaccount.com')
                                  toast.success('E-mail copiado!')
                                }}
                                className="shrink-0 p-1.5 rounded hover:bg-slate-200 transition-colors"
                                title="Copiar e-mail"
                              >
                                <Copy className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                            </div>
                            <p className="text-xs text-slate-600">
                              3. Cole a URL da planilha abaixo:
                            </p>
                          </div>
                          <Input
                            id="google_sheets_url"
                            type="url"
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            value={sheetsUrl}
                            onChange={(e) => setSheetsUrl(e.target.value)}
                            className="text-sm"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const url = sheetsUrl.trim()
                              if (!url) {
                                toast.error('Link de planilha inválido. Cole a URL completa do Google Sheets.')
                                return
                              }
                              try {
                                toast.loading('Conectando planilha...', { id: 'sheets-connect' })
                                const res = await fetch(`/api/forms/${form.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    google_sheets_url: url,
                                  }),
                                })
                                const data = await res.json()
                                if (!res.ok) {
                                  throw new Error(data.error || 'Não foi possível conectar a planilha. Tente novamente.')
                                }
                                const updated = data.form
                                setForm({
                                  ...form,
                                  google_sheets_id: updated.google_sheets_id,
                                  google_sheets_enabled: true,
                                })
                                setSheetsUrl('')
                                if (data.google_sheets_title) setSheetsTitle(data.google_sheets_title)
                                setHasUnsavedChanges(false)
                                toast.success('Planilha conectada com sucesso!', { id: 'sheets-connect' })
                              } catch (err: unknown) {
                                const message = err instanceof Error ? err.message : 'Não foi possível conectar a planilha. Tente novamente.'
                                toast.error(message, { id: 'sheets-connect' })
                              }
                            }}
                            className="w-full py-2 px-3 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                          >
                            Conectar Planilha
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Webhook */}
                  <div className={`p-4 rounded-lg border border-slate-200 space-y-3 mt-3 ${userPlan !== 'plus' && userPlan !== 'professional' ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                        {userPlan !== 'plus' && userPlan !== 'professional' ? (
                          <Lock className="w-4 h-4 text-violet-600" />
                        ) : (
                          <Globe className="w-4 h-4 text-violet-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">
                          Webhook
                          {userPlan !== 'plus' && userPlan !== 'professional' && (
                            <span className="ml-2 text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">Plus+</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">Notificação POST enviada com os dados da resposta ao submeter</p>
                      </div>
                    </div>
                    {userPlan !== 'plus' && userPlan !== 'professional' ? (
                      <p className="text-xs text-slate-500">
                        Disponível nos planos Plus e Professional.{' '}
                        <Link href="/billing" className="text-violet-600 underline">Fazer upgrade</Link>
                      </p>
                    ) : (
                      <Input
                        id="webhook_url"
                        value={form.webhook_url || ''}
                        onChange={(e) => {
                          setForm({ ...form, webhook_url: e.target.value || null })
                          setHasUnsavedChanges(true)
                        }}
                        className="text-slate-900 placeholder:text-slate-400 text-sm"
                        placeholder="https://webhook.site/seu-endpoint"
                      />
                    )}
                  </div>
                </section>

                {/* ── Seção 3: Automação e notificações ── */}
                <section>
                  <div className="flex items-center gap-2.5 mb-4">
                    <Bell className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Automação e notificações</h3>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>

                  {/* E-mail */}
                  <div className={`p-4 rounded-lg border border-slate-200 space-y-3 ${userPlan !== 'plus' && userPlan !== 'professional' ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                        {userPlan !== 'plus' && userPlan !== 'professional' ? (
                          <Lock className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Mail className="w-4 h-4 text-blue-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">
                          Notificação por E-mail
                          {userPlan !== 'plus' && userPlan !== 'professional' && (
                            <span className="ml-2 text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Plus+</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">Você receberá um e-mail automaticamente a cada nova resposta enviada no formulário.</p>
                      </div>
                      {(userPlan === 'plus' || userPlan === 'professional') && (
                        <Switch
                          checked={form.notify_email_enabled ?? false}
                          onCheckedChange={(checked) => {
                            setForm({ ...form, notify_email_enabled: checked })
                            setHasUnsavedChanges(true)
                          }}
                        />
                      )}
                    </div>
                    {userPlan !== 'plus' && userPlan !== 'professional' ? (
                      <p className="text-xs text-slate-500">
                        Disponível nos planos Plus e Professional.{' '}
                        <Link href="/billing" className="text-blue-600 underline">Fazer upgrade</Link>
                      </p>
                    ) : form.notify_email_enabled ? (
                      <div>
                        <Label className="text-xs text-slate-600">E-mail de destino</Label>
                        <Input
                          value={form.notify_email ?? ""}
                          onChange={(e) => {
                            setForm({ ...form, notify_email: e.target.value || null })
                            setHasUnsavedChanges(true)
                          }}
                          className="mt-1.5 text-slate-900 placeholder:text-slate-400 text-sm"
                          placeholder="seu@email.com"
                          type="email"
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* WhatsApp */}
                  <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3 mt-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                        <MessageCircle className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-700">Notificação por WhatsApp</p>
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">EM BREVE</span>
                        </div>
                        <p className="text-xs text-slate-500">Em breve. Configuração salva, envio disponível em breve.</p>
                      </div>
                      <Switch
                        checked={form.notify_whatsapp_enabled ?? false}
                        onCheckedChange={(checked) => {
                          setForm({ ...form, notify_whatsapp_enabled: checked })
                          setHasUnsavedChanges(true)
                        }}
                        aria-label="Ativar notificação WhatsApp"
                      />
                    </div>
                    {form.notify_whatsapp_enabled && (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        ⚠️ Esta integração está em desenvolvimento. A configuração será salva mas ainda não enviará dados.
                      </p>
                    )}
                  </div>
                </section>

              </div>
            </TabsContent>

            <TabsContent value="share" className="flex-1 mt-0 overflow-auto data-[state=inactive]:hidden">
              <div className="p-4 space-y-6">
                <div>
                  <Label className="text-sm font-medium text-slate-700">Link do Formulário</Label>
                  <p className="text-xs text-slate-500 mt-0.5">Compartilhe este link para receber respostas</p>
                  <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <code className="text-sm text-blue-600 break-all">
                      {typeof window !== 'undefined' ? `${window.location.origin}/f/${form.slug}` : `/f/${form.slug}`}
                    </code>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyFormLink}
                      className="flex-1"
                    >
                      <Copy className="w-4 h-4 mr-1.5" />
                      Copiar link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="flex-1"
                    >
                      <a
                        href={`/f/${form.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-4 h-4 mr-1.5" />
                        Abrir formulário
                      </a>
                    </Button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="share-slug" className="text-sm font-medium text-slate-700">URL do Formulário</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">/f/</span>
                    <Input
                      id="share-slug"
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
              </div>
            </TabsContent>
          </Tabs>
        </aside>

        {/* Center: Preview */}
        <div className={`${shouldShowMobilePreview ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0 overflow-auto bg-slate-100 p-4 md:p-8`}>
          <div className="max-w-2xl mx-auto w-full">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mb-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
                {/* B17: Dots de janela estilo macOS */}
                <div className="flex items-center gap-1.5 mr-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FF5F56' }} />
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FFBD2E' }} />
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#27C93F' }} />
                </div>
                <Eye className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-600">Visualização</span>
                <div className="ml-auto flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                  <button
                    onClick={() => setPreviewMode("full")}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      previewMode === "full"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Completo
                  </button>
                  <button
                    onClick={() => {
                      setPreviewMode("step")
                      // Sync step index with selected question
                      const idx = questions.findIndex(q => q.id === selectedQuestionId)
                      setStepPreviewIndex(idx >= 0 ? idx : 0)
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      previewMode === "step"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Passo a passo
                  </button>
                </div>
              </div>
              <div
                className="min-h-[500px]"
                style={{
                  backgroundColor: currentTheme.backgroundColor,
                  fontFamily: currentTheme.fontFamily
                }}
              >
                {previewMode === "full" ? (
                  <FormPreview
                    questions={questions}
                    theme={currentTheme}
                    selectedQuestionId={selectedQuestionId}
                    onSelectQuestion={setSelectedQuestionId}
                    onUpdateQuestion={updateQuestion}
                  />
                ) : (
                  <>
                    <FormPreview
                      questions={questions.length > 0 ? [questions[stepPreviewIndex] || questions[0]] : []}
                      theme={currentTheme}
                      selectedQuestionId={questions[stepPreviewIndex]?.id || null}
                      onSelectQuestion={setSelectedQuestionId}
                      onUpdateQuestion={updateQuestion}
                    />
                    {questions.length > 1 && (
                      <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: `${currentTheme.textColor}15` }}>
                        <button
                          onClick={() => setStepPreviewIndex(i => Math.max(0, i - 1))}
                          disabled={stepPreviewIndex === 0}
                          className="flex items-center gap-1 text-sm font-medium disabled:opacity-30 transition-opacity"
                          style={{ color: currentTheme.textColor }}
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Anterior
                        </button>
                        <span className="text-xs" style={{ color: `${currentTheme.textColor}80` }}>
                          {stepPreviewIndex + 1} / {questions.length}
                        </span>
                        <button
                          onClick={() => setStepPreviewIndex(i => Math.min(questions.length - 1, i + 1))}
                          disabled={stepPreviewIndex >= questions.length - 1}
                          className="flex items-center gap-1 text-sm font-medium disabled:opacity-30 transition-opacity"
                          style={{ color: currentTheme.textColor }}
                        >
                          Próxima
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Fixed property editor */}
        <aside className={`${shouldShowMobileRightPanel ? 'flex' : 'hidden'} md:flex w-full max-w-full md:w-80 lg:w-96 bg-white border-l border-slate-200 flex-col shrink-0 overflow-hidden`}>
          <RightPanel
            selectedQuestion={selectedQuestion || null}
            allQuestions={questions}
            onUpdateQuestion={updateQuestion}
            onDeleteQuestion={deleteQuestion}
            onDuplicateQuestion={duplicateQuestion}
            ownerPlan={userPlan}
            sidebarSection={sidebarSection}
            form={form}
            onUpdateForm={(updates) => {
              setForm(prev => ({ ...prev, ...updates }))
              setHasUnsavedChanges(true)
            }}
            onWelcomeImageUpload={handleWelcomeImageUpload}
            onRemoveWelcomeImage={handleRemoveWelcomeImage}
            isUploadingImage={isUploadingImage}
          />
        </aside>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-50">
        <button
          onClick={() => setMobilePanel('questions')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: shouldShowMobileSidebar ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          Perguntas
        </button>
        <button
          onClick={() => {
            if (isMobileUtilityTab) setActiveTab('questions')
            setMobilePanel('editor')
          }}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: !isMobileUtilityTab && mobilePanel === 'editor' ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          Editar
        </button>
        <button
          onClick={() => {
            if (isMobileUtilityTab) setActiveTab('questions')
            setMobilePanel('preview')
          }}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors text-slate-400`} style={{ color: !isMobileUtilityTab && mobilePanel === 'preview' ? '#F5B731' : undefined }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Preview
        </button>
      </div>

      {/* Add Question Dialog — B09: Menu categorizado */}
      <Dialog open={showAddQuestion} onOpenChange={setShowAddQuestion}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Adicionar Pergunta</DialogTitle>
            <DialogDescription>
              Escolha o tipo de pergunta para adicionar
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 overflow-y-auto max-h-[60vh] pr-1 space-y-5">
            {[
              {
                label: 'Texto',
                types: ['short_text', 'long_text', 'email', 'phone'],
              },
              {
                label: 'Escolhas',
                types: ['dropdown', 'checkboxes', 'yes_no', 'nps', 'rating', 'opinion_scale'],
              },
              {
                label: 'Dados',
                types: ['number', 'date', 'url', 'address', 'cpf'],
              },
              {
                label: 'Conteúdo',
                types: ['content_block'],
              },
              {
                label: 'Arquivo',
                types: ['file_upload'],
              },
              {
                label: 'Integração',
                types: ['calendly'],
              },
            ].map((category) => {
              const categoryQuestionTypes = category.types
                .map(t => questionTypes.find(qt => qt.type === t))
                .filter(Boolean) as typeof questionTypes
              if (categoryQuestionTypes.length === 0) return null
              return (
                <div key={category.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{category.label}</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {categoryQuestionTypes.map((qt) => {
                      const visual = getQuestionVisual(qt.type)
                      return (
                        <button
                          key={qt.type}
                          onClick={() => addQuestion(qt.type)}
                          className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left group flex items-start gap-3"
                        >
                          <div className={`mt-0.5 shrink-0 ${visual.color}`}>
                            <visual.icon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-slate-900">{qt.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{qt.description}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Leave Confirmation Dialog */}
      <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterações não salvas</DialogTitle>
            <DialogDescription>
              Você tem alterações que ainda não foram salvas. Deseja salvar antes de sair?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowLeaveDialog(false)
                router.push('/dashboard')
              }}
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              Sair sem salvar
            </Button>
            <Button
              onClick={async () => {
                const saved = await handleSave()
                if (!saved) return
                setShowLeaveDialog(false)
                router.push('/dashboard')
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Salvar e sair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.status === 'published' ? 'Publicar alterações?' : 'Publicar formulário?'}
            </DialogTitle>
            <DialogDescription>
              {form.status === 'published'
                ? 'As alterações atuais serão aplicadas na versão publicada do formulário.'
                : 'Seu formulário ficará acessível em:'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 bg-slate-50 rounded-lg">
            <code className="text-sm text-blue-600">
              {typeof window !== 'undefined' ? window.location.origin : ''}/f/{form.slug}
            </code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublishDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handlePublish}
              disabled={isSaving}
              className={form.status === 'published' 
                ? 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20'
              }
            >
              {isSaving ? 'Salvando...' : 'Publicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  )
}
