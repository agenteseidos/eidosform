/**
 * /api/forms/[id]/capi-token — a porta do token de CAPI.
 *
 * Esta rota nasceu SEM testes, e o parecer independente de 18/08/2026 apontou isso como lacuna:
 * é a única porta por onde entra uma credencial de terceiro (o token que injeta evento na conta
 * de anúncios do cliente). Autorização errada aqui vale mais que qualquer outro bug do lote.
 *
 * O que estes testes trancam:
 *  · sem sessão, sem nada;
 *  · formulário alheio e formulário inexistente respondem IGUAL (404) — 403 confirmaria a
 *    existência do formulário de outro cliente para quem só tem o UUID;
 *  · o token NUNCA volta no GET;
 *  · falha temporária do Meta (rede, 429, 5xx) não destrói a credencial que já funcionava e não
 *    mente dizendo que salvou;
 *  · DELETE não exige plano — quem fez downgrade tem de conseguir remover a própria credencial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

const validar = vi.hoisted(() => vi.fn(async () => ({ estado: 'ok' as const, conclusivo: true })))
vi.mock('@/lib/meta-capi', () => ({ validarCredencialCapi: validar }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const servicoFrom = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => ({ from: servicoFrom }) }))

import { GET, PUT, DELETE } from './route'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = vi.mocked(createClient)
const FORM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ctx = { params: Promise.resolve({ id: FORM }) }

let gravado: Record<string, unknown> | null = null

function supabaseFalso({ user = 'dono-1', donoDoForm = 'dono-1', plan = 'plus', semForm = false } = {}) {
  const from = vi.fn((tabela: string) => {
    if (tabela === 'forms') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: semForm ? null : { id: FORM, user_id: donoDoForm, pixels: { metaPixelId: '123456789012345' } },
              error: null,
            }),
          }),
        }),
      }
    }
    return { select: () => ({ eq: () => ({ single: async () => ({ data: { plan, plan_expires_at: null } }) }) }) }
  })
  return { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) }, from }
}

function servicoFalso(credencial: Record<string, unknown> | null = null) {
  servicoFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: credencial, error: null }) }) }),
    upsert: async (payload: Record<string, unknown>) => { gravado = payload; return { error: null } },
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  gravado = null
  validar.mockImplementation(async () => ({ estado: 'ok' as const, conclusivo: true }))
  process.env.META_CAPI_ENC_KEY = 'a'.repeat(64)
  servicoFalso()
})

describe('autorização', () => {
  it('sem sessão: 401 em todos os verbos', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ user: '' }) as never)
    expect((await GET({} as never, ctx)).status).toBe(401)
    mockCreateClient.mockResolvedValue(supabaseFalso({ user: '' }) as never)
    expect((await DELETE({} as never, ctx)).status).toBe(401)
  })

  it('formulário de OUTRO cliente e formulário inexistente respondem igual (404)', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ donoDoForm: 'outro-dono' }) as never)
    const alheio = await GET({} as never, ctx)

    mockCreateClient.mockResolvedValue(supabaseFalso({ semForm: true }) as never)
    const inexistente = await GET({} as never, ctx)

    expect(alheio.status).toBe(404)
    expect(inexistente.status).toBe(404)
    expect(await alheio.json()).toEqual(await inexistente.json())
  })

  it('plano sem o recurso não grava token', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'starter' }) as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(403)
    expect(gravado).toBeNull()
  })

  it('DELETE NÃO exige plano — quem fez downgrade tem de poder remover a credencial', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free' }) as never)
    expect((await DELETE({} as never, ctx)).status).toBe(200)
  })
})

describe('GET nunca devolve o token', () => {
  it('responde só a dica e o estado', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    servicoFalso({
      hint: '••••ab12', pixel_id: '123456789012345',
      validated_at: '2026-08-18T00:00:00Z', last_error: null,
      token_encrypted: 'v1.SEGREDO.NAO.PODE.VAZAR',
    })
    const corpo = await (await GET({} as never, ctx)).json() as Record<string, unknown>
    expect(corpo.configurado).toBe(true)
    expect(corpo.dica).toBe('••••ab12')
    expect(JSON.stringify(corpo)).not.toContain('SEGREDO')
    expect(JSON.stringify(corpo)).not.toContain('token_encrypted')
  })

  it('avisa quando o Pixel mudou depois da validação', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    servicoFalso({ hint: '••••1', pixel_id: '999999999999999', validated_at: null, last_error: null })
    const corpo = await (await GET({} as never, ctx)).json() as Record<string, unknown>
    expect(corpo.pixelDivergente).toBe(true)
  })
})

describe('PUT', () => {
  it('token validado é gravado cifrado, com dica e pixel', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    const r = await PUT({ json: async () => ({ token: 'EAAG' + 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(200)
    expect(gravado?.form_id).toBe(FORM)
    expect(gravado?.pixel_id).toBe('123456789012345')
    // Cifrado, nunca em claro.
    expect(String(gravado?.token_encrypted)).toMatch(/^v1\./)
    expect(String(gravado?.token_encrypted)).not.toContain('EAAG')
  })

  /**
   * O token do fluxo "sem a Dataset Quality API" ENVIA evento mas pode não LER o pixel. A
   * validação por leitura reprovava esse token — aconteceu no primeiro teste real. Quando a prova
   * não é conclusiva, a credencial é gravada SEM data de validação, e a tela diz isso.
   */
  it('prova inconclusiva grava a credencial mas NÃO carimba data de validação', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    validar.mockImplementation(async () => ({ estado: 'ok', conclusivo: false }) as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(200)
    expect(gravado?.token_encrypted).toBeTruthy()
    expect(gravado?.validated_at).toBeNull()
    expect((await r.json() as Record<string, unknown>).validadoEm).toBeNull()
  })

  it('token RECUSADO pelo Meta não é gravado', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    validar.mockImplementation(async () => ({ estado: 'recusado', motivo: 'Token inválido ou expirado.' }) as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(400)
    expect(gravado).toBeNull()
  })

  /** O bug que o parecer pegou: a mensagem dizia "foi salvo" e nada era salvo. */
  it('falha TEMPORÁRIA do Meta devolve 503 e não grava nem apaga nada', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    validar.mockImplementation(async () => ({ estado: 'temporario', motivo: 'Meta indisponível.' }) as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(503)
    expect((await r.json() as Record<string, unknown>).temporario).toBe(true)
    expect(gravado).toBeNull()
  })

  it('corrida com o autosave: Pixel da tela diferente do banco devolve 409', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40), pixelEsperado: '555555555555555' }) } as never, ctx)
    expect(r.status).toBe(409)
    expect(gravado).toBeNull()
  })

  it('sem a chave de cifragem, recusa em vez de guardar em claro', async () => {
    delete process.env.META_CAPI_ENC_KEY
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    const r = await PUT({ json: async () => ({ token: 'x'.repeat(40) }) } as never, ctx)
    expect(r.status).toBe(503)
    expect(gravado).toBeNull()
  })

  it('token vazio ou absurdamente longo é recusado sem chamar o Meta', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    expect((await PUT({ json: async () => ({ token: '  ' }) } as never, ctx)).status).toBe(400)
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)
    expect((await PUT({ json: async () => ({ token: 'x'.repeat(501) }) } as never, ctx)).status).toBe(400)
    expect(validar).not.toHaveBeenCalled()
  })
})
