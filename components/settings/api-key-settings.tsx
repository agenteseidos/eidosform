'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Key, Copy, Eye, EyeOff, RefreshCw, Trash2, Lock, Loader2, ShieldAlert, BookOpen, Terminal } from 'lucide-react'
import { toast } from 'sonner'

interface ApiKeySettingsProps {
  isProfessional: boolean
}

export function ApiKeySettings({ isProfessional }: ApiKeySettingsProps) {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/api-key', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao gerar API Key')
        return
      }
      setApiKey(data.api_key)
      setNewKey(data.api_key)
      setShowKey(true)
      toast.success('API Key gerada! Copie agora — não será exibida novamente.', { duration: 6000 })
    } catch {
      toast.error('Erro de conexão ao gerar API Key')
    } finally {
      setLoading(false)
    }
  }

  const copyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey)
      toast.success('API Key copiada!')
    }
  }

  const handleRevoke = async () => {
    if (!confirmRevoke) {
      setConfirmRevoke(true)
      return
    }
    setRevoking(true)
    try {
      const res = await fetch('/api/settings/api-key', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Erro ao revogar API Key')
        return
      }
      setApiKey(null)
      setNewKey(null)
      setShowKey(false)
      setConfirmRevoke(false)
      toast.success('API Key revogada com sucesso.')
    } catch {
      toast.error('Erro de conexão ao revogar API Key')
    } finally {
      setRevoking(false)
    }
  }

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 15)}${'•'.repeat(24)}${apiKey.slice(-4)}`
    : null

  if (!isProfessional) {
    return (
      <Card className="p-6 mb-6 border-dashed border-2 border-slate-200">
        <div className="flex items-center gap-3 mb-3">
          <Key className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-700">API Key</h2>
          <Lock className="w-4 h-4 text-slate-400" />
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Acesse a API do EidosForm programaticamente. Disponível no plano Professional.
        </p>
        <Button disabled variant="outline" className="opacity-50 cursor-not-allowed">
          🔒 Upgrade para Professional
        </Button>
      </Card>
    )
  }

  return (
    <>
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Key className="w-5 h-5 text-[#F5B731]" />
          <h2 className="text-lg font-semibold text-slate-900">API Key</h2>
          <Badge className="bg-[#F5B731]/10 text-[#E8923A] border-0 text-xs font-semibold">Professional</Badge>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          Use sua API Key para acessar o EidosForm programaticamente. Guarde em local seguro — ela não será exibida novamente após geração.
        </p>

        {!apiKey ? (
          <div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 mb-4 flex items-center gap-3">
              <Key className="w-4 h-4 text-slate-500" />
              <span className="text-sm text-slate-400 font-mono">Nenhuma API Key gerada</span>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="bg-[#F5B731] hover:bg-[#E8923A] text-white font-medium"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Gerando...</>
                : <><RefreshCw className="w-4 h-4 mr-2" />Gerar API Key</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {newKey && (
              <div className="bg-[#F5B731]/10 border border-[#F5B731]/30 rounded-xl p-4">
                <p className="text-xs font-semibold text-[#E8923A] mb-2">
                  ⚠️ Copie agora! Esta key não será exibida novamente.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={showKey ? newKey : maskedKey || ''}
                    className="font-mono text-xs flex-1 bg-white border-[#F5B731]/40"
                  />
                  <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)} className="border-[#F5B731]/40">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" onClick={copyKey} className="bg-[#F5B731] hover:bg-[#E8923A] text-white">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {!newKey && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
                <Key className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-600 font-mono">{maskedKey}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span className="text-xs text-slate-500 flex-1">
                {confirmRevoke ? 'Tem certeza? Esta ação é irreversível.' : 'Revogar apaga a key atual permanentemente.'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                disabled={revoking}
                className={`border-red-200 text-red-600 hover:bg-red-50 transition-all ${confirmRevoke ? 'bg-red-50 border-red-400 font-semibold' : ''}`}
              >
                {revoking
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Revogando...</>
                  : <><Trash2 className="w-3 h-3 mr-1" />{confirmRevoke ? 'Confirmar revogação' : 'Revogar'}</>}
              </Button>
              {confirmRevoke && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Documentação da API */}
      <Card className="p-6 mb-6 border-slate-200">
        <div className="flex items-center gap-3 mb-4">
          <BookOpen className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900">Como usar a API</h2>
          <Badge className="bg-[#F5B731]/10 text-[#E8923A] border-0 text-xs font-semibold">Professional</Badge>
        </div>

        <p className="text-sm text-slate-600 mb-5">
          A API do EidosForm permite gerenciar formulários e acessar respostas programaticamente.
          Inclua sua <code className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono">X-API-Key</code> em todas as requisições.
        </p>

        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wide">Base URL</p>
            <div className="bg-slate-900 rounded-lg p-3 flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <code className="text-xs text-emerald-400 font-mono">https://eidosform.com.br/api/v1</code>
            </div>
          </div>

          {/* Auth */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wide">Autenticação</p>
            <div className="bg-slate-900 rounded-lg p-3">
              <code className="text-xs text-slate-300 font-mono">X-API-Key: sua_api_key_aqui</code>
            </div>
          </div>

          {/* Endpoints */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Endpoints disponíveis</p>
            <div className="space-y-2">
              {[
                { method: 'GET', path: '/api/v1/forms', desc: 'Listar todos os formulários' },
                { method: 'GET', path: '/api/v1/forms/:id', desc: 'Detalhes de um formulário' },
                { method: 'GET', path: '/api/v1/forms/:id?resource=responses', desc: 'Respostas de um formulário' },
                { method: 'POST', path: '/api/v1/forms/:id', desc: 'Submeter uma resposta' },
              ].map(({ method, path, desc }) => (
                <div key={path} className="flex items-start gap-2 p-2.5 bg-slate-50 rounded-lg">
                  <span className={`text-xs font-bold font-mono shrink-0 w-10 ${method === 'GET' ? 'text-blue-600' : 'text-emerald-600'}`}>{method}</span>
                  <code className="text-xs font-mono text-slate-700 flex-1">{path}</code>
                  <span className="text-xs text-slate-500 shrink-0">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Curl example */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wide">Exemplo — listar formulários</p>
            <div className="bg-slate-900 rounded-lg p-3 overflow-x-auto">
              <pre className="text-xs text-slate-300 font-mono whitespace-pre">{`curl https://eidosform.com.br/api/v1/forms \\
  -H "X-API-Key: sua_api_key_aqui"`}</pre>
            </div>
          </div>

          {/* Response example */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wide">Resposta esperada</p>
            <div className="bg-slate-900 rounded-lg p-3 overflow-x-auto">
              <pre className="text-xs text-emerald-400 font-mono whitespace-pre">{`{
  "forms": [
    { "id": "uuid", "title": "Meu Formulário", "status": "published", ... }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "total_pages": 1 }
}`}</pre>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Limite de requisições: <strong>60 req/min</strong> por API Key.
            Para plano Enterprise, consulte limites estendidos.
          </p>
        </div>
      </Card>
    </>
  )
}
