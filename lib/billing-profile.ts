import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { AsaasCustomerPayload } from '@/lib/asaas'
import { isValidCpfOrCnpj as _isValidCpfOrCnpj } from '@/lib/cpf-cnpj'

export { isValidCpfOrCnpj } from '@/lib/cpf-cnpj'

export type BillingProfile = {
  profileId: string
  email: string
  fullName: string
  phone: string | null
  cpfCnpj: string | null
  address: string | null
  addressNumber: string | null
  postalCode: string | null
  province: string | null
  city: string | null
  state: string | null
  asaasCustomerId: string | null
  asaasSubscriptionId: string | null
  asaasCardToken: string | null
  plan: string
  plan_cycle: string | null
  plan_expires_at: string | null
  prorationBasisDays: number | null
}

export type BillingFieldKey = keyof Pick<
  BillingProfile,
  'fullName' | 'email' | 'phone' | 'cpfCnpj' | 'address' | 'addressNumber' | 'postalCode' | 'province' | 'city' | 'state'
>

export const REQUIRED_BILLING_FIELDS: BillingFieldKey[] = [
  'fullName',
  'email',
  'phone',
  'cpfCnpj',
  'address',
  'addressNumber',
  'postalCode',
  'province',
  'city',
  'state',
]

export const BILLING_FIELD_LABELS: Record<BillingFieldKey, string> = {
  fullName: 'Nome completo',
  email: 'E-mail',
  phone: 'Telefone',
  cpfCnpj: 'CPF ou CNPJ',
  address: 'Endereço',
  addressNumber: 'Número',
  postalCode: 'CEP',
  province: 'Bairro',
  city: 'Cidade',
  state: 'Estado (UF)',
}

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function digitsOnly(value: string | null) {
  return value ? value.replace(/\D/g, '') : null
}

export function mapProfileRowToBillingProfile(profile: Record<string, unknown>, userEmail?: string | null): BillingProfile {
  const rawEmail = cleanString(profile.email) ?? cleanString(userEmail)
  return {
    profileId: String(profile.id),
    email: rawEmail ?? '',
    fullName: cleanString(profile.full_name) ?? (rawEmail ? rawEmail.split('@')[0] : ''),
    phone: cleanString(profile.phone),
    cpfCnpj: cleanString(profile.cpf_cnpj),
    address: cleanString(profile.address),
    addressNumber: cleanString(profile.address_number),
    postalCode: cleanString(profile.postal_code),
    province: cleanString(profile.province),
    city: cleanString(profile.city),
    state: cleanString(profile.state),
    asaasCustomerId: cleanString(profile.asaas_customer_id),
    asaasSubscriptionId: cleanString(profile.asaas_subscription_id),
    asaasCardToken: cleanString(profile.asaas_card_token),
    plan: cleanString(profile.plan) ?? 'free',
    plan_cycle: cleanString(profile.plan_cycle),
    plan_expires_at: cleanString(profile.plan_expires_at),
    prorationBasisDays: typeof profile.proration_basis_days === 'number' ? profile.proration_basis_days : null,
  }
}

export function getMissingBillingFields(profile: BillingProfile): BillingFieldKey[] {
  return REQUIRED_BILLING_FIELDS.filter((field) => {
    const value = profile[field]
    if (!value) return true
    if (field === 'cpfCnpj') return !_isValidCpfOrCnpj(value)
    if (field === 'postalCode') return digitsOnly(value)?.length !== 8
    if (field === 'phone') return (digitsOnly(value)?.length ?? 0) < 10
    return false
  })
}

export function toAsaasCustomerPayload(profile: BillingProfile): AsaasCustomerPayload {
  const phone = digitsOnly(profile.phone) ?? undefined
  const cpfCnpj = digitsOnly(profile.cpfCnpj) ?? undefined
  const postalCode = digitsOnly(profile.postalCode) ?? undefined

  return {
    name: profile.fullName,
    email: profile.email,
    phone,
    mobilePhone: phone,
    cpfCnpj,
    address: profile.address ?? undefined,
    addressNumber: profile.addressNumber ?? undefined,
    postalCode,
    province: profile.province ?? undefined,
    city: profile.city ?? undefined,
    state: profile.state ?? undefined,
  }
}

export async function getBillingProfileForUser(userId: string, fallbackEmail?: string | null) {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, cpf_cnpj, address, address_number, postal_code, province, city, state, asaas_customer_id, asaas_subscription_id, asaas_card_token, plan, plan_cycle, plan_expires_at, proration_basis_days')
    .eq('id', userId)
    .single()

  if (!profile) return null
  return mapProfileRowToBillingProfile(profile as unknown as Record<string, unknown>, fallbackEmail)
}

export function createBillingServiceClient(serviceRoleKey: string) {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey)
}
