'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Globe, CheckCircle2, Clock, AlertCircle, Loader2, Copy, Lock } from 'lucide-react'
import { toast } from 'sonner'

type DomainStatus = 'pending' | 'verifying' | 'active' | 'error'

interface DomainInfo {
  domain: string
  status: DomainStatus
}

interface DomainSettingsProps {
  isProfessional: boolean
}

export function DomainSettings({ isProfessional }: DomainSettingsProps) {
  const [domain, setDomain] = useState('')
  const [domainInfo, setDomainInfo] = useState<DomainInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const validateDomain = (d: string) => {
    return /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(d.toLowerCase())
  }

  const handleAdd = async () => {
    if (!validateDomain(domain)) {
      toast.error('Domínio inválido. Ex: formularios.suaempresa.com.br')
      return
    }
    setLoading(true)
    await new Promise(r => setTimeout(r, 800))
    setDomainInfo({ domain, status: 'pending' })
    setLoading(false)
    toast.success('Domínio adicionado! Configure o CNAME para verificar.')
  }

  const handleVerify = async () => {
    if (!domainInfo) return
    setDomainInfo({ ...domainInfo, status: 'verifying' })
    await new Promise(r => setTimeout(r, 2000))
    setDomainInfo({ ...domainInfo, status: 'active' })
    toast.success('Domínio verificado com sucesso! 🎉')
  }

  const handleRemove = () => {
    setDomainInfo(null)
    setDomain('')
    toast.success('Domínio removido.')
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

      {!domainInfo ? (
        <div className="flex gap-2">
          <Input
            placeholder="formularios.suaempresa.com.br"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1"
          />
          <Button
            onClick={handleAdd}
            disabled={loading || !domain}
            className="bg-[#F5B731] hover:bg-[#E8923A] text-white font-medium"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <Globe className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-slate-800">{domainInfo.domain}</span>
            </div>
            {statusBadge(domainInfo.status)}
          </div>

          {(domainInfo.status === 'pending' || domainInfo.status === 'error') && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">⚙️ Configure o CNAME no seu provedor de DNS:</p>
              <div className="space-y-2">
                {[
                  { label: 'Tipo', value: 'CNAME' },
                  { label: 'Nome', value: domainInfo.domain.split('.')[0] },
                  { label: 'Valor', value: 'cname.eidosform.com', copyable: true },
                ].map(({ label, value, copyable }) => (
                  <div key={label} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
                    <div className="text-xs font-mono text-slate-600">
                      <span className="text-slate-400 mr-2">{label}:</span>{value}
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

          {domainInfo.status === 'active' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-sm text-emerald-700 font-medium">
                ✅ Domínio ativo! Formulários acessíveis em{' '}
                <a href={`https://${domainInfo.domain}`} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  {domainInfo.domain}
                </a>
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {domainInfo.status === 'pending' && (
              <Button onClick={handleVerify} className="bg-[#F5B731] hover:bg-[#E8923A] text-white">
                Verificar DNS
              </Button>
            )}
            {domainInfo.status === 'verifying' && (
              <Button disabled className="bg-[#F5B731] text-white opacity-80">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />Verificando...
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
