'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MapPin, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isValidCpfOrCnpj } from '@/lib/cpf-cnpj'

type FieldKey =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'cpfCnpj'
  | 'address'
  | 'addressNumber'
  | 'postalCode'
  | 'province'
  | 'city'
  | 'state'

type FormState = Record<FieldKey | 'complement', string>

interface BillingFieldsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData: Partial<FormState>
  missingFields: string[]
  onSaved: () => void
  saveError?: string | null
}

const FIELDS: Array<{ key: FieldKey; label: string; placeholder?: string; gridClass?: string; type?: string; maxLength?: number }> = [
  { key: 'fullName', label: 'Nome completo ou nome da empresa', placeholder: 'Seu nome ou nome da sua empresa', gridClass: 'md:col-span-2' },
  { key: 'email', label: 'E-mail', type: 'email', gridClass: 'md:col-span-2' },
  { key: 'phone', label: 'Telefone', placeholder: '(11) 99999-9999' },
  { key: 'cpfCnpj', label: 'CPF ou CNPJ', placeholder: '000.000.000-00' },
  { key: 'postalCode', label: 'CEP', placeholder: '00000-000' },
  { key: 'state', label: 'Estado (UF)', placeholder: 'SP', maxLength: 2 },
  { key: 'address', label: 'Endereço', placeholder: 'Rua, avenida, etc.', gridClass: 'md:col-span-2' },
  { key: 'addressNumber', label: 'Número' },
  { key: 'province', label: 'Bairro' },
  { key: 'city', label: 'Cidade' },
]

export function BillingFieldsDialog({
  open,
  onOpenChange,
  initialData,
  missingFields,
  onSaved,
  saveError,
}: BillingFieldsDialogProps) {
  const supabase = createClient()
  const missingSet = new Set(missingFields)

  const [form, setForm] = useState<FormState>(() => ({
    fullName: initialData.fullName ?? '',
    email: initialData.email ?? '',
    phone: initialData.phone ?? '',
    cpfCnpj: initialData.cpfCnpj ?? '',
    address: initialData.address ?? '',
    addressNumber: initialData.addressNumber ?? '',
    postalCode: initialData.postalCode ?? '',
    province: initialData.province ?? '',
    city: initialData.city ?? '',
    state: initialData.state ?? '',
    complement: initialData.complement ?? '',
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [loadingCep, setLoadingCep] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  useEffect(() => {
    setInlineError(saveError ?? null)
  }, [saveError])

  function updateField<K extends keyof FormState>(field: K, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const lookupCep = useCallback(async (rawCep: string) => {
    const cep = rawCep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setLoadingCep(true)
    try {
      const res = await fetch(`/api/cep/${cep}`)
      const data = await res.json()
      if (data.error) return
      setForm((prev) => ({
        ...prev,
        address: data.street || prev.address,
        province: data.neighborhood || prev.province,
        city: data.city || prev.city,
        state: data.state || prev.state,
        postalCode: rawCep,
      }))
    } catch {
      // silent
    } finally {
      setLoadingCep(false)
    }
  }, [])

  function validateLocal(): string | null {
    if (!form.fullName.trim()) return 'Informe seu nome completo'
    if (form.cpfCnpj && !isValidCpfOrCnpj(form.cpfCnpj)) return 'CPF ou CNPJ inválido — verifique os dígitos'
    const cep = form.postalCode.replace(/\D/g, '')
    if (form.postalCode && cep.length !== 8) return 'CEP deve ter 8 dígitos'
    const phone = form.phone.replace(/\D/g, '')
    if (form.phone && phone.length < 10) return 'Telefone deve ter pelo menos 10 dígitos'
    return null
  }

  async function handleSave() {
    const validationError = validateLocal()
    if (validationError) {
      setInlineError(validationError)
      return
    }
    setInlineError(null)
    setIsSaving(true)
    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id
      if (!userId) {
        setInlineError('Sessão expirada. Faça login novamente.')
        return
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: form.fullName.trim(),
          phone: form.phone.trim() || null,
          cpf_cnpj: form.cpfCnpj.trim() || null,
          address: form.address.trim() || null,
          address_number: form.addressNumber.trim() || null,
          postal_code: form.postalCode.trim() || null,
          complement: form.complement?.trim() || null,
          province: form.province.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
        })
        .eq('id', userId)

      if (error) {
        console.error('billing dialog save error', error)
        setInlineError('Não consegui salvar os dados. Tente novamente.')
        return
      }

      await supabase.auth.updateUser({ data: { full_name: form.fullName.trim() } }).catch(() => {})

      toast.success('Dados salvos. Continuando para o pagamento...')
      onSaved()
    } catch (err) {
      console.error(err)
      setInlineError('Erro inesperado ao salvar. Tente novamente.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-amber-600" />
            Complete seus dados de cobrança
          </DialogTitle>
          <DialogDescription>
            Faltam algumas informações pra abrir o checkout. Os campos em destaque são obrigatórios.
          </DialogDescription>
        </DialogHeader>

        {inlineError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{inlineError}</div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          {FIELDS.map((f) => {
            const isMissing = missingSet.has(f.key)
            const value = form[f.key]
            const isEmail = f.key === 'email'
            const fieldClass = [
              'mt-1.5',
              isMissing ? 'border-amber-400 focus-visible:ring-amber-400' : '',
              !isMissing && value ? 'bg-slate-50 text-slate-700' : '',
            ].filter(Boolean).join(' ')

            return (
              <div key={f.key} className={f.gridClass ?? ''}>
                <Label htmlFor={`bf-${f.key}`} className="flex items-center gap-1.5">
                  {f.label}
                  {isMissing && <span className="text-xs font-medium text-amber-600">• obrigatório</span>}
                </Label>
                {f.key === 'postalCode' ? (
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      id={`bf-${f.key}`}
                      value={value}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      className={[
                        'flex-1',
                        isMissing ? 'border-amber-400 focus-visible:ring-amber-400' : '',
                        !isMissing && value ? 'bg-slate-50 text-slate-700' : '',
                      ].filter(Boolean).join(' ')}
                      onChange={(e) => {
                        updateField(f.key, e.target.value)
                        lookupCep(e.target.value)
                      }}
                    />
                    {loadingCep && <Loader2 className="w-5 h-5 animate-spin text-slate-400 self-center" />}
                  </div>
                ) : (
                  <Input
                    id={`bf-${f.key}`}
                    type={f.type ?? 'text'}
                    value={value}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    disabled={isEmail}
                    className={fieldClass}
                    onChange={(e) =>
                      updateField(f.key, f.key === 'state' ? e.target.value.toUpperCase() : e.target.value)
                    }
                  />
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter className="mt-4 flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar e continuar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
