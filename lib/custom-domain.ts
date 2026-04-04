// lib/custom-domain.ts — Vercel Custom Domains API + DNS CNAME validation

import { resolveCname } from 'dns/promises'

const VERCEL_API = 'https://api.vercel.com'
const VERCEL_DOMAIN_SUFFIX = 'vercel.app' // Expected target for CNAME validation

function getVercelConfig() {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) {
    throw new Error('VERCEL_TOKEN and VERCEL_PROJECT_ID env vars are required')
  }
  return { token, projectId }
}

export interface DomainResult {
  success: boolean
  domain?: string
  error?: string
  verified?: boolean
  cname?: string
  aRecords?: string[]
}

/**
 * Adiciona um domínio personalizado ao projeto Vercel e associa ao formSlug.
 */
export async function addDomain(domain: string, formSlug: string): Promise<DomainResult> {
  const { token, projectId } = getVercelConfig()

  const res = await fetch(`${VERCEL_API}/v10/projects/${projectId}/domains`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: domain }),
  })

  const data = await res.json()

  if (!res.ok) {
    return {
      success: false,
      error: data.error?.message ?? `Vercel API error: ${res.status}`,
    }
  }

  return {
    success: true,
    domain: data.name,
    verified: data.verified ?? false,
    cname: data.cname,
    aRecords: data.aRecords,
  }
}

/**
 * Remove um domínio personalizado do projeto Vercel.
 */
export async function removeDomain(domain: string): Promise<DomainResult> {
  const { token, projectId } = getVercelConfig()

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/domains/${domain}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (res.status === 204 || res.ok) {
    return { success: true, domain }
  }

  const data = await res.json()
  return {
    success: false,
    error: data.error?.message ?? `Vercel API error: ${res.status}`,
  }
}

/**
 * Valida se o CNAME de um domínio aponta para um domínio Vercel válido.
 * Retorna true se o DNS está configurado corretamente.
 */
export async function validateDomainCNAME(domain: string): Promise<boolean> {
  try {
    const cnames = await resolveCname(domain)
    if (!Array.isArray(cnames) || cnames.length === 0) {
      return false
    }

    // Verifica se algum CNAME aponta para um domínio vercel.app
    return cnames.some((cname) => cname.includes(VERCEL_DOMAIN_SUFFIX))
  } catch (error) {
    // DNS resolution failed or domain doesn't exist
    console.warn(`CNAME validation failed for domain ${domain}:`, error)
    return false
  }
}

/**
 * Verifica o status de verificação de um domínio no Vercel.
 * Agora também valida DNS CNAME antes de marcar como verified=true.
 */
export async function checkDomainStatus(domain: string): Promise<DomainResult> {
  const { token, projectId } = getVercelConfig()

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/domains/${domain}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await res.json()

  if (!res.ok) {
    return {
      success: false,
      error: data.error?.message ?? `Vercel API error: ${res.status}`,
    }
  }

  // Validar DNS CNAME antes de confirmar verificação
  const vercelVerified = data.verified ?? false
  const dnsValid = vercelVerified ? await validateDomainCNAME(domain) : false

  return {
    success: true,
    domain: data.name,
    verified: vercelVerified && dnsValid, // Both must be true
    cname: data.cname,
    aRecords: data.aRecords,
  }
}
