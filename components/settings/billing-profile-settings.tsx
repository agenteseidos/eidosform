'use client'

import { useState, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MapPin, Loader2, MessageCircleWarning } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface BillingProfileSettingsProps {
  initialData: {
    fullName: string
    email: string
    phone: string
    cpfCnpj: string
    address: string
    addressNumber: string
    complement: string
    postalCode: string
    province: string
    city: string
    state: string
  }
}

export function BillingProfileSettings({ initialData }: BillingProfileSettingsProps) {
  const supabase = createClient()
  const [form, setForm] = useState(initialData)
  const [isSaving, setIsSaving] = useState(false)
  const [loadingCep, setLoadingCep] = useState(false)
  // Confirmação de troca de TELEFONE (decisão Sidney 05/08): é dado sensível —
  // define onde chegam as confirmações por WhatsApp e como a atendente
  // reconhece a conta. Troca só com confirmação explícita.
  const [confirmPhoneOpen, setConfirmPhoneOpen] = useState(false)
  const phoneChanged = (form.phone ?? '').replace(/\D/g, '') !== (initialData.phone ?? '').replace(/\D/g, '')

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const lookupCep = useCallback(async (rawCep: string) => {
    const cep = rawCep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setLoadingCep(true)
    try {
      const res = await fetch(`/api/cep/${cep}`)
      const data = await res.json()
      if (data.error) {
        toast.error(data.error === 'CEP not found' ? 'CEP não encontrado' : 'Erro ao buscar CEP')
        return
      }
      setForm((prev) => ({
        ...prev,
        address: data.street || prev.address,
        province: data.neighborhood || prev.province,
        city: data.city || prev.city,
        state: data.state || prev.state,
        postalCode: rawCep,
      }))
    } catch {
      toast.error('Erro ao buscar CEP')
    } finally {
      setLoadingCep(false)
    }
  }, [])

  async function handleSave(opts?: { phoneConfirmed?: boolean }) {
    if (!form.fullName.trim()) {
      toast.error('Informe seu nome completo')
      return
    }
    // Telefone mudou e ainda não foi confirmado → abre o diálogo em vez de salvar.
    if (phoneChanged && initialData.phone && !opts?.phoneConfirmed) {
      setConfirmPhoneOpen(true)
      return
    }

    setIsSaving(true)
    try {
      // Save via rota SERVER (05/08): a troca de TELEFONE propaga — e-mail de
      // segurança, Asaas na hora e aviso à atendente. Client-side não alcança isso.
      const res = await fetch('/api/settings/billing-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || null,
          cpfCnpj: form.cpfCnpj.trim() || null,
          address: form.address.trim() || null,
          addressNumber: form.addressNumber.trim() || null,
          postalCode: form.postalCode.trim() || null,
          complement: form.complement?.trim() || null,
          province: form.province.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Não consegui salvar os dados de cobrança.')
        return
      }

      const { error: authError } = await supabase.auth.updateUser({
        data: { full_name: form.fullName.trim() },
      })

      if (authError) {
        console.error('auth metadata update error', authError)
      }

      toast.success('Dados de cobrança atualizados')
    } catch (error) {
      console.error(error)
      toast.error('Erro inesperado ao salvar dados de cobrança.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <MapPin className="w-5 h-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Dados de cobrança</h2>
          <p className="text-sm text-slate-500">Preencha os dados exigidos pelo checkout do Asaas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Label htmlFor="billing-full-name">Nome completo ou nome da empresa</Label>
          <Input id="billing-full-name" value={form.fullName} onChange={(e) => updateField('fullName', e.target.value)} className="mt-1.5" placeholder="Seu nome ou o nome da sua empresa" />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="billing-email">E-mail</Label>
          <Input id="billing-email" type="email" value={form.email} disabled className="mt-1.5 bg-slate-50 text-slate-500" />
        </div>
        <div>
          <Label htmlFor="billing-phone">Telefone</Label>
          <Input id="billing-phone" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} className="mt-1.5" placeholder="(11) 99999-9999" />
        </div>
        <div>
          <Label htmlFor="billing-cpfcnpj">CPF ou CNPJ</Label>
          <Input id="billing-cpfcnpj" value={form.cpfCnpj} onChange={(e) => updateField('cpfCnpj', e.target.value)} className="mt-1.5" placeholder="000.000.000-00" />
        </div>
        <div>
          <Label htmlFor="billing-postal-code">CEP</Label>
          <div className="flex gap-2 mt-1.5">
            <Input id="billing-postal-code" value={form.postalCode} onChange={(e) => { updateField('postalCode', e.target.value); lookupCep(e.target.value) }} className="flex-1" placeholder="00000-000" />
            {loadingCep && <Loader2 className="w-5 h-5 animate-spin text-slate-400 self-center" />}
          </div>
        </div>
        <div>
          <Label htmlFor="billing-state">Estado (UF)</Label>
          <Input id="billing-state" value={form.state} onChange={(e) => updateField('state', e.target.value.toUpperCase())} className="mt-1.5" placeholder="SP" maxLength={2} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="billing-address">Endereço</Label>
          <Input id="billing-address" value={form.address} onChange={(e) => updateField('address', e.target.value)} className="mt-1.5" placeholder="Rua, avenida, etc." />
        </div>
        <div>
          <Label htmlFor="billing-address-number">Número</Label>
          <Input id="billing-address-number" value={form.addressNumber} onChange={(e) => updateField('addressNumber', e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="billing-complement">Complemento</Label>
          <Input id="billing-complement" value={form.complement ?? ''} onChange={(e) => updateField('complement' as keyof typeof form, e.target.value)} className="mt-1.5" placeholder="Apto, sala, bloco..." />
        </div>
        <div>
          <Label htmlFor="billing-province">Bairro</Label>
          <Input id="billing-province" value={form.province} onChange={(e) => updateField('province', e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="billing-city">Cidade</Label>
          <Input id="billing-city" value={form.city} onChange={(e) => updateField('city', e.target.value)} className="mt-1.5" />
        </div>
      </div>

      <Button className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium" onClick={() => handleSave()} disabled={isSaving}>
        {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : 'Salvar dados de cobrança'}
      </Button>

      {/* Confirmação de troca de telefone (dado sensível — decisão Sidney 05/08). */}
      <Dialog open={confirmPhoneOpen} onOpenChange={setConfirmPhoneOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircleWarning className="w-5 h-5 text-amber-500" />
              Confirmar alteração de telefone
            </DialogTitle>
            <DialogDescription>
              O telefone define <strong>onde você recebe as confirmações da sua conta por WhatsApp</strong> e
              como nosso atendimento reconhece você. Confira com atenção:
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
            <p className="text-slate-500">Número anterior: <span className="line-through">{initialData.phone || '—'}</span></p>
            <p className="mt-1 font-semibold text-slate-800">Número novo: {form.phone || '—'}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmPhoneOpen(false)}>Cancelar</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => { setConfirmPhoneOpen(false); void handleSave({ phoneConfirmed: true }) }}
            >
              Confirmar novo telefone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
