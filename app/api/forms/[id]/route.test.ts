/**
 * PATCH /api/forms/[id] — campo de plano superior IGNORA, nunca recusa.
 *
 * Esta rota tinha 8 portões de plano, controle otimista de versão e ZERO testes.
 *
 * O DEFEITO: cada portão devolvia 403 e derrubava o salvamento INTEIRO. O construtor reenvia o
 * formulário completo em todo autosave — inclusive campos que já estavam gravados e que o dono
 * nem abriu. Então um Free que herdou webhook/pixel/redirect de um plano pago não conseguia salvar
 * NADA: nem corrigir um erro de digitação no título. E a tela não oferecia como apagar o valor,
 * porque o controle virou cadeado. Formulário em somente-leitura permanente, sem saída.
 *
 * Quem sempre foi Free nunca vive isso — na criação esses campos são descartados em silêncio. Era,
 * por construção, uma regra que só existia de um lado. A decisão do Sidney ("quem regride para o
 * Free termina onde está quem acabou de cadastrar") exige que os dois se comportem igual.
 *
 * ⚠️ Ignorar NÃO libera recurso pago. Quem decide se o webhook dispara, se o pixel carrega ou se o
 * e-mail sai é o gate de ENTREGA, que continua olhando o plano em cada disparo. Aqui só se decide
 * se o dono consegue SALVAR o formulário dele.
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

const purgarAnexos = vi.hoisted(() => vi.fn(async () => ({ revogados: 0, removidos: 0 })))
vi.mock('@/lib/form-file-purge', () => ({ purgarAnexos }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/request-auth', () => ({ getRequestUser: vi.fn(async () => ({ id: 'dono-1' })) }))
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), log: vi.fn() }))
// O recálculo tem teste próprio em `lib/plan-limits.test.ts`; aqui só interessa SE é chamado.
const recomputeActiveForms = vi.fn(async () => ({ pausedCount: 0 }))
vi.mock('@/lib/plan-limits', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/plan-limits')>()
  return { ...real, recomputeActiveForms: (...a: unknown[]) => recomputeActiveForms(...(a as [])) }
})

import { PATCH, DELETE } from './route'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = vi.mocked(createClient)

/** O que foi de fato gravado no banco na última chamada. */
let updatePayload: Record<string, unknown> = {}

type Cenario = {
  plan?: string
  /** perguntas JÁ gravadas no formulário (o legado herdado do plano pago) */
  questoesAtuais?: number
}

function supabaseFalso({ plan = 'free', questoesAtuais = 10, semFormulario = false }: Cenario & { semFormulario?: boolean } = {}) {
  const existing = {
    id: 'f1',
    title: 'Anamnese',
    questions: Array.from({ length: questoesAtuais }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `P${i}` })),
    google_sheets_id: null,
    google_sheets_enabled: false,
    version: 3,
    notify_owner_enabled: null,
    notify_email_enabled: null,
    notify_email: null,
  }
  const from = vi.fn((table: string) => {
    if (table === 'forms') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: semFormulario ? null : existing, error: null }) }) }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload
          return {
            eq: () => ({
              eq: () => ({ select: () => ({ single: async () => ({ data: { ...existing, ...payload }, error: null }) }) }),
              select: () => ({ single: async () => ({ data: { ...existing, ...payload }, error: null }) }),
            }),
          }
        },
      }
    }
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { plan, plan_expires_at: null, email: 'dono@x.com' } }) }) }) }
    }
    return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }
  })
  return { from } as unknown as Awaited<ReturnType<typeof createClient>>
}

const req = (body: Record<string, unknown>) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as import('next/server').NextRequest

const params = Promise.resolve({ id: 'f1' })

beforeEach(() => {
  updatePayload = {}
  recomputeActiveForms.mockClear()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste'
})

describe('PATCH — o formulário do rebaixado volta a salvar', () => {
  it('Free com webhook herdado consegue trocar o TÍTULO', async () => {
    // O caso exato do bug: ele só quer arrumar o título, e o construtor reenvia o webhook junto.
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free' }))
    const res = await PATCH(req({ title: 'Novo título', webhook_url: 'https://crm.cliente.com/hook' }), { params })

    expect(res.status).toBe(200)
    expect(updatePayload.title).toBe('Novo título')
  })

  it('o campo pago é OMITIDO do update — o valor gravado não é tocado', async () => {
    // Omitir, jamais reescrever o valor persistido de volta: é o que mantém o dado herdado
    // intacto ("manter lá, sem funcionar") e faz reverter esta mudança não deixar resíduo.
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free' }))
    await PATCH(req({ title: 'X', webhook_url: 'https://crm.cliente.com/hook', redirect_url: 'https://site.com' }), { params })

    expect(Object.keys(updatePayload)).not.toContain('webhook_url')
    expect(Object.keys(updatePayload)).not.toContain('redirect_url')
  })

  it('a resposta AVISA quais campos foram descartados', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free' }))
    const res = await PATCH(req({
      title: 'X',
      webhook_url: 'https://crm.cliente.com/hook',
      redirect_url: 'https://site.com',
      hide_branding: true,
      notify_email_enabled: true,
      pixels: { metaPixelId: '123456789012345' },
    }), { params })
    const body = await res.json() as { ignored_fields?: string[] }

    expect(body.ignored_fields).toEqual(
      expect.arrayContaining(['webhook_url', 'redirect_url', 'hide_branding', 'notify_email_enabled', 'pixels'])
    )
  })

  it('plano PAGO continua gravando os campos normalmente', async () => {
    // A correção não pode virar "ninguém mais consegue configurar webhook".
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'plus' }))
    const res = await PATCH(req({ title: 'X', webhook_url: 'https://crm.cliente.com/hook' }), { params })
    const body = await res.json() as { ignored_fields?: string[] }

    expect(updatePayload.webhook_url).toBe('https://crm.cliente.com/hook')
    expect(body.ignored_fields).toBeUndefined()
  })
})

describe('PATCH — teto de perguntas trava o CRESCIMENTO, não a edição', () => {
  it('formulário legado de 40 perguntas SALVA quando o dono edita sem aumentar', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free', questoesAtuais: 40 }))
    const quarenta = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `Corrigida ${i}` }))
    const res = await PATCH(req({ questions: quarenta }), { params })

    expect(res.status).toBe(200)
  })

  it('REDUZIR de 40 para 25 é permitido — é o caminho de volta', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free', questoesAtuais: 40 }))
    const vinteCinco = Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `P${i}` }))
    const res = await PATCH(req({ questions: vinteCinco }), { params })

    expect(res.status).toBe(200)
  })

  it('AUMENTAR de 40 para 41 é recusado, com mensagem que explica a saída', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free', questoesAtuais: 40 }))
    const quarentaUm = Array.from({ length: 41 }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `P${i}` }))
    const res = await PATCH(req({ questions: quarentaUm }), { params })
    const body = await res.json() as { error?: string }

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/não adicionar novas/i)
  })

  it('quem está DENTRO do teto continua barrado ao passar dele', async () => {
    // Free com 10 perguntas tentando ir a 26: é criação de excesso, não legado.
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free', questoesAtuais: 10 }))
    const vinteSeis = Array.from({ length: 26 }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `P${i}` }))
    const res = await PATCH(req({ questions: vinteSeis }), { params })

    expect(res.status).toBe(403)
  })
})

describe('PATCH — recálculo do que fica no ar', () => {
  it('salvar num plano COM teto dispara o recálculo (é o que reativa o formulário reduzido)', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'free', questoesAtuais: 40 }))
    const vinteCinco = Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, type: 'short_text', title: `P${i}` }))
    await PATCH(req({ questions: vinteCinco }), { params })

    expect(recomputeActiveForms).toHaveBeenCalledWith('chave-de-teste', 'dono-1', 'free')
  })

  it('plano ILIMITADO não gasta chamada de recálculo', async () => {
    mockCreateClient.mockResolvedValue(supabaseFalso({ plan: 'professional' }))
    await PATCH(req({ title: 'X' }), { params })

    expect(recomputeActiveForms).not.toHaveBeenCalled()
  })
})

describe('🛡️ DELETE — a purga de anexos NUNCA roda antes da autorização (P0, 16/08)', () => {
  // Eu introduzi este defeito na própria implementação dos anexos privados: a purga ficava ANTES
  // do `if (!user) return 401`. Qualquer pessoa com o UUID de um formulário publicado mandava
  // DELETE sem sessão, o servidor apagava TODOS os anexos com service-role, e só então respondia
  // "Unauthorized". O formulário sobrevivia; os documentos dos leads, não.
  beforeEach(() => { purgarAnexos.mockClear() })

  it('sem sessão → 401 e NENHUM anexo tocado', async () => {
    const { getRequestUser } = await import('@/lib/supabase/request-auth')
    vi.mocked(getRequestUser).mockResolvedValueOnce(null as never)
    mockCreateClient.mockResolvedValue(supabaseFalso() as never)

    const res = await DELETE(req({}), { params })

    expect(res.status).toBe(401)
    expect(purgarAnexos).not.toHaveBeenCalled()
  })

  it('logado, mas o formulário não é dele → nenhum anexo tocado', async () => {
    const { getRequestUser } = await import('@/lib/supabase/request-auth')
    vi.mocked(getRequestUser).mockResolvedValueOnce({ id: 'intruso' } as never)
    // A consulta com `.eq(user_id)` não acha nada — é a prova de propriedade falhando.
    mockCreateClient.mockResolvedValue(supabaseFalso({ semFormulario: true }) as never)

    await DELETE(req({}), { params })

    expect(purgarAnexos).not.toHaveBeenCalled()
  })
})
