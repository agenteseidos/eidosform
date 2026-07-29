import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCustomDomain } from './middleware'

describe('resolveCustomDomain', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('usa somente a RPC pública mínima e retorna o slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ slug: 'form-publico' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveCustomDomain('forms.cliente.test')).resolves.toBe('form-publico')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://project.supabase.co/rest/v1/rpc/resolve_public_custom_domain'
    )
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ p_hostname: 'forms.cliente.test' }),
    })
  })

  it('falha fechado quando o resolver não encontra domínio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }))
    await expect(resolveCustomDomain('inexistente.cliente.test')).resolves.toBeNull()
  })
})
