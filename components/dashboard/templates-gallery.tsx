'use client'

import { useState } from 'react'
import { templates, FormTemplate } from '@/lib/templates'
import { questionTypes } from '@/lib/questions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowRight, FileText, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

const categories = ['Todos', 'Marketing', 'Vendas', 'Feedback', 'Eventos', 'Pesquisa', 'Engajamento', 'Agência', 'Geral']

export function TemplatesGallery() {
  const [open, setOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('Todos')
  const [preview, setPreview] = useState<FormTemplate | null>(null)
  const router = useRouter()

  const filtered = templates.filter(
    t => selectedCategory === 'Todos' || t.category === selectedCategory
  )

  const handleUseTemplate = (template: FormTemplate) => {
    // Passa o template via query param (id) para a página de criação
    router.push(`/forms/new?template=${template.id}`)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-slate-200 text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen(true)}
      >
        <FileText className="w-4 h-4 mr-2" />
        Templates
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">
                📋 Escolha um template
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-500 mt-1">
              10 formulários prontos para usar — edite como quiser depois
            </p>

            {/* Filtros de categoria */}
            <div className="flex gap-2 flex-wrap mt-4">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filtered.map(template => (
                <Card
                  key={template.id}
                  className="p-4 border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => setPreview(template)}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ backgroundColor: template.theme.backgroundColor }}
                    >
                      {template.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm leading-tight">{template.name}</p>
                      <Badge className="bg-slate-100 text-slate-500 text-xs mt-1 font-normal">
                        {template.category}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">
                    {template.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {template.questions.length} perguntas
                    </span>
                    <span className="text-xs text-blue-600 font-medium group-hover:underline">
                      Ver detalhes →
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview modal */}
      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: preview.theme.backgroundColor }}
                >
                  {preview.emoji}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{preview.name}</h3>
                  <p className="text-xs text-slate-500">{preview.questions.length} perguntas · {preview.category}</p>
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-4">{preview.description}</p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {preview.questions.map((q, i) => (
                <div key={q.id} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-400 font-mono mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                  <div>
                    <p className="text-sm text-slate-800 font-medium leading-snug">{q.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 capitalize">{questionTypes.find(qt => qt.type === q.type)?.label ?? q.type.replace('_', ' ')} {q.required ? '· obrigatória' : ''}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button
              className="w-full font-semibold"
              style={{ backgroundColor: preview.theme.primaryColor }}
              onClick={() => handleUseTemplate(preview)}
            >
              Usar este template <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
