// lib/custom-domain.ts — Vercel Custom Domains API

const VERCEL_API = 'https://api.vercel.com'

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
 * Verifica o status de verificação de um domínio no Vercel.
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

  return {
    success: true,
    domain: data.name,
    verified: data.verified ?? false,
    cname: data.cname,
    aRecords: data.aRecords,
  }
}
