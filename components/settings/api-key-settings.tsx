'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Key, Copy, Eye, EyeOff, RefreshCw, Trash2, Lock, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

interface ApiKeySettingsProps {
  isProfessional: boolean
}

export function ApiKeySettings({ isProfessional }: ApiKeySettingsProps) {
  const [hasApiKey, setHasApiKey] = useState(false)
  const [apiKeyPreview, setApiKeyPreview] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  // Load current API key status on mount
  useEffect(() => {
    if (!isProfessional) {
      setInitialLoading(false)
      return
    }

    fetch('/api/settings/api-key')
      .then((res) => res.json())
      .then((data) => {
        setHasApiKey(data.has_api_key ?? false)
        setApiKeyPreview(data.api_key_preview ?? null)
      })
      .catch(() => {
        // silently fail
      })
      .finally(() => setInitialLoading(false))
  }, [isProfessional])

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/api-key', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao gerar API Key')
        return
      }

      setNewKey(data.api_key)
      setHasApiKey(true)
      setShowKey(true)
      toast.success('API Key gerada! Copie agora — não será exibida novamente.', {
        duration: 6000,
      })
    } catch {
      toast.error('Erro ao gerar API Key. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
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
      setHasApiKey(false)
      setApiKeyPreview(null)
      setNewKey(null)
      setShowKey(false)
      setConfirmRevoke(false)
      toast.success('API Key revogada com sucesso.')
    } catch {
      toast.error('Erro ao revogar API Key. Tente novamente.')
    } finally {
      setRevoking(false)
    }
  }

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

  if (initialLoading) {
    return (
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          <span className="text-sm text-slate-500">Carregando configurações de API...</span>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <Key className="w-5 h-5 text-[#F5B731]" />
        <h2 className="text-lg font-semibold text-slate-900">API Key</h2>
        <Badge className="bg-[#F5B731]/10 text-[#E8923A] border-0 text-xs font-semibold">Professional</Badge>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Use sua API Key para acessar o EidosForm programaticamente. Guarde em local seguro — ela não será exibida novamente após geração.
      </p>

      {!hasApiKey ? (
        <div>
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 mb-4 flex items-center gap-3">
            <Key className="w-4 h-4 text-slate-500" />
            <span className="text-sm text-slate-500 font-mono">Nenhuma API Key gerada</span>
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
          {newKey ? (
            <div className="bg-[#F5B731]/10 border border-[#F5B731]/30 rounded-xl p-4">
              <p className="text-xs font-semibold text-[#E8923A] mb-2">
                ⚠️ Copie agora! Esta key não será exibida novamente.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  readOnly
                  value={showKey ? newKey : `${newKey.slice(0, 8)}${'•'.repeat(24)}${newKey.slice(-4)}`}
                  className="w-full min-w-0 flex-1 truncate font-mono text-xs bg-white border-[#F5B731]/40"
                />
                <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)} className="border-[#F5B731]/40">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button size="sm" onClick={copyKey} className="bg-[#F5B731] hover:bg-[#E8923A] text-white">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3 min-w-0 overflow-hidden">
              <Key className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="max-w-full truncate text-sm text-slate-600 font-mono">{apiKeyPreview ?? '••••••••'}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              {loading
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Regenerando...</>
                : <><RefreshCw className="w-3 h-3 mr-1" />Regenerar Key</>}
            </Button>
          </div>

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
  )
}
