'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Globe, CheckCircle2, Clock, AlertCircle, Loader2, Copy, Lock } from 'lucide-react'
import { toast } from 'sonner'

type DomainStatus = 'pending' | 'verifying' | 'active' | 'error'

interface DomainRecord {
  id: string
  domain: string
  verified: boolean
  form_id: string
}

interface DomainSettingsProps {
  isProfessional: boolean
  defaultFormId?: string | null
}

export function DomainSettings({ isProfessional, defaultFormId }: DomainSettingsProps) {
  const [domain, setDomain] = useState('')
  const [domainRecord, setDomainRecord] = useState<DomainRecord | null>(null)
  const [verifyStatus, setVerifyStatus] = useState<DomainStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [verifying, setVerifying] = useState(false)

  // Fetch existing domain on mount
  useEffect(() => {
    if (!isProfessional) {
      setFetching(false)
      return
    }
    fetch('/api/domains')
      .then(res => res.json())
      .then(data => {
        const domains = data.domains || []
        if (domains.length > 0) {
          const d = domains[0]
          setDomainRecord(d)
          setVerifyStatus(d.verified ? 'active' : 'pending')
        }
      })
      .catch(() => {
        toast.error('Erro ao carregar domínios')
      })
      .finally(() => setFetching(false))
  }, [isProfessional])

  const validateDomain = (d: string) => {
    return /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(d.toLowerCase())
  }

  const handleAdd = async () => {
    if (!validateDomain(domain)) {
      toast.error('Domínio inválido. Ex: formularios.suaempresa.com.br')
      return
    }

    if (!defaultFormId) {
      toast.error('Crie ao menos um formulário antes de configurar um domínio personalizado.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, form_id: defaultFormId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao adicionar domínio')
        return
      }
      setDomainRecord({ id: '', domain, verified: data.verified || false, form_id: defaultFormId })
      setVerifyStatus(data.verified ? 'active' : 'pending')
      toast.success('Domínio adicionado! Configure o CNAME para verificar.')
    } catch {
      toast.error('Erro de rede ao adicionar domínio')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!domainRecord) return
    setVerifying(true)
    setVerifyStatus('verifying')
    try {
      const res = await fetch('/api/domains', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainRecord.domain }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyStatus('error')
        toast.error(data.error || 'Erro ao verificar domínio')
        return
      }
      if (data.verified) {
        setVerifyStatus('active')
        setDomainRecord(prev => prev ? { ...prev, verified: true } : prev)
        toast.success('Domínio verificado com sucesso! 🎉')
      } else {
        setVerifyStatus('pending')
        toast.info('DNS ainda não propagado. Tente novamente em alguns minutos.')
      }
    } catch {
      setVerifyStatus('error')
      toast.error('Erro de rede ao verificar domínio')
    } finally {
      setVerifying(false)
    }
  }

  const handleRemove = async () => {
    if (!domainRecord) return
    try {
      const res = await fetch('/api/domains', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainRecord.domain }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Erro ao remover domínio')
        return
      }
      setDomainRecord(null)
      setVerifyStatus(null)
      setDomain('')
      toast.success('Domínio removido.')
    } catch {
      toast.error('Erro de rede ao remover domínio')
    }
  }

  const copyCname = () => {
    navigator.clipboard.writeText('cname.eidosform.com')
    toast.success('Copiado!')
  }

  const statusBadge = (status: DomainStatus) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-amber-100 text-amber-700 border-0 flex items-center gap-1"><Clock className="w-3 h-3" />Pendente</Badge>
      case 'verifying':
        return <Badge className="bg-blue-100 text-blue-700 border-0 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Verificando</Badge>
      case 'active':
        return <Badge className="bg-emerald-100 text-emerald-700 border-0 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Ativo</Badge>
      case 'error':
        return <Badge className="bg-red-100 text-red-700 border-0 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Erro</Badge>
    }
  }

  if (!isProfessional) {
    return (
      <Card className="p-6 mb-6 border-dashed border-2 border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <Globe className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-700">Domínio Personalizado</h2>
          <Lock className="w-4 h-4 text-slate-400" />
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Use seu próprio domínio para hospedar seus formulários. Disponível no plano Professional.
        </p>
        <Button disabled variant="outline" className="opacity-50 cursor-not-allowed">
          🔒 Upgrade para Professional
        </Button>
      </Card>
    )
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <Globe className="w-5 h-5 text-[#F5B731]" />
        <h2 className="text-lg font-semibold text-slate-900">Domínio Personalizado</h2>
        <Badge className="bg-[#F5B731]/10 text-[#E8923A] border-0 text-xs font-semibold">Professional</Badge>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Configure seu domínio personalizado para que seus formulários fiquem acessíveis no seu próprio endereço.
      </p>

      {fetching ? (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
          <span className="text-sm text-slate-500">Carregando...</span>
        </div>
      ) : !domainRecord ? (
        <div className="space-y-3">
          {!defaultFormId && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Crie pelo menos um formulário para vincular o domínio personalizado.
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="formularios.suaempresa.com.br"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1"
            />
            <Button
              onClick={handleAdd}
              disabled={loading || !domain || !defaultFormId}
              className="w-full bg-[#F5B731] font-medium text-white hover:bg-[#E8923A] sm:w-auto"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <Globe className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-slate-800">{domainRecord.domain}</span>
            </div>
            {verifyStatus && statusBadge(verifyStatus)}
          </div>

          {(verifyStatus === 'pending' || verifyStatus === 'error') && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">⚙️ Configure o CNAME no seu provedor de DNS:</p>
              <div className="space-y-2">
                {[
                  { label: 'Tipo', value: 'CNAME' },
                  { label: 'Nome', value: domainRecord.domain.split('.')[0] },
                  { label: 'Valor', value: 'cname.eidosform.com', copyable: true },
                ].map(({ label, value, copyable }) => (
                  <div key={label} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
                    <div className="text-xs font-mono text-slate-600">
                      <span className="text-slate-500 mr-2">{label}:</span>{value}
                    </div>
                    {copyable && (
                      <Button variant="ghost" size="sm" onClick={copyCname} className="h-7 text-xs">
                        <Copy className="w-3 h-3 mr-1" />Copiar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-3">
                ⏱️ A propagação do DNS pode levar até 48 horas.
              </p>
            </div>
          )}

          {verifyStatus === 'active' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-sm text-emerald-700 font-medium">
                ✅ Domínio ativo! Formulários acessíveis em{' '}
                <a href={`https://${domainRecord.domain}`} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  {domainRecord.domain}
                </a>
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {(verifyStatus === 'pending' || verifyStatus === 'error') && (
              <Button
                onClick={handleVerify}
                disabled={verifying}
                className="bg-[#F5B731] hover:bg-[#E8923A] text-white"
              >
                {verifying
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verificando...</>
                  : 'Verificar DNS'}
              </Button>
            )}
            <Button variant="outline" onClick={handleRemove} className="border-red-200 text-red-600 hover:bg-red-50">
              Remover domínio
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
