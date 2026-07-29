import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { GET } from './route'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = vi.mocked(createClient)

/**
 * COLUNAS REAIS da tabela `responses` em produção (conferido 2026-07-28 via
 * OpenAPI do PostgREST). O endpoint já consultou `created_at`/`updated_at`,
 * que NÃO EXISTEM aqui: a query falhava calada e o "tempo médio" vinha sempre
 * nulo — feature morta anunciada como viva. Este mock recusa qualquer coluna
 * fora desta lista, então o bug volta a quebrar o teste, não a produção.
 */
const RESPONSES_COLUMNS = new Set([
  'answers', 'completed', 'form_id', 'id', 'last_activity_at',
  'last_question_answered', 'meta_events', 'partial_revision',
  'partial_session_hash', 'respondent_id', 'sheets_row_index', 'submitted_at',
  'url_params', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source',
  'utm_term',
])

const QUESTIONS = [
  { id: 'q1', title: 'Qual seu nome?' },
  { id: 'q2', title: 'Qual seu orçamento?' },
]

type Opts = {
  plan?: string
  incomplete?: Array<{ last_question_answered: string }>
  totalCount?: number
  completedCount?: number
}

const selectedColumns: string[] = []
const responseFilters: Array<Array<[string, unknown]>> = []

function makeSupabase({ plan = 'plus', incomplete = [], totalCount = 10, completedCount = 6 }: Opts = {}) {
  const from = vi.fn((table: string) => {
    if (table === 'forms') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'f1', questions: QUESTIONS }, error: null }) }) }) }) }
    }
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { plan, plan_expires_at: null } }) }) }) }
    }
    // responses: registra as colunas pedidas e rejeita coluna inexistente,
    // como o PostgREST faria.
    return {
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
        const filters: Array<[string, unknown]> = []
        responseFilters.push(filters)
        for (const c of cols.split(',').map((s) => s.trim())) {
          selectedColumns.push(c)
          if (!RESPONSES_COLUMNS.has(c)) {
            throw new Error(`coluna inexistente em responses: "${c}"`)
          }
        }
        const isCount = opts?.count === 'exact'
        const result = isCount
          ? { count: selectedColumns.includes('id') && cols === 'id' ? undefined : undefined }
          : { data: incomplete }
        const chain: Record<string, unknown> = {}
        const thenable = {
          eq: () => chain,
          not: () => chain,
          limit: () => chain,
          then: (res: (v: unknown) => void) => res(result),
        }
        Object.assign(chain, thenable)
        // O count é resolvido pela cadeia .eq(...).eq(...) — devolve o número
        // conforme a chamada (total vs completed) na ordem em que o route faz.
        let eqCalls = 0
        chain.eq = (column: string, value: unknown) => {
          filters.push([column, value])
          eqCalls += 1
          return {
            ...thenable,
            then: (res: (v: unknown) => void) =>
              res(isCount ? { count: eqCalls >= 2 ? completedCount : totalCount } : { data: incomplete }),
            eq: (nextColumn: string, nextValue: unknown) => {
              filters.push([nextColumn, nextValue])
              return {
                ...thenable,
                then: (res: (v: unknown) => void) => res(isCount ? { count: completedCount } : { data: incomplete }),
                not: () => ({ ...thenable, then: (res: (v: unknown) => void) => res({ data: incomplete }) }),
              }
            },
            not: () => ({ ...thenable, then: (res: (v: unknown) => void) => res({ data: incomplete }) }),
          }
        }
        return chain
      },
    }
  })

  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) }, from }
}

const req = {} as Parameters<typeof GET>[0]
const params = { params: Promise.resolve({ id: 'f1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  selectedColumns.length = 0
  responseFilters.length = 0
})

describe('GET /api/forms/[id]/analytics — schema', () => {
  it('NÃO consulta colunas que não existem em responses (created_at/updated_at)', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase() as never)
    const res = await GET(req, params)
    expect(res.status).toBe(200)
    expect(selectedColumns).not.toContain('created_at')
    expect(selectedColumns).not.toContain('updated_at')
    for (const c of selectedColumns) expect(RESPONSES_COLUMNS.has(c)).toBe(true)
  })

  it('devolve o contrato completo, com avg_completion_time_seconds nulo', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase() as never)
    const body = await (await GET(req, params)).json()
    expect(Object.keys(body).sort()).toEqual([
      'abandonment_by_question', 'avg_completion_time_seconds', 'completed_responses',
      'completion_rate', 'form_id', 'plan_gated', 'total_responses',
    ])
    // Métrica desativada: sem timestamp de início não dá para calcular. Nulo
    // explícito, nunca um número inventado.
    expect(body.avg_completion_time_seconds).toBeNull()
  })

  it('isola TODAS as queries de responses pelo form_id do dono', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ plan: 'plus' }) as never)
    expect((await GET(req, params)).status).toBe(200)
    expect(responseFilters).toHaveLength(3)
    for (const filters of responseFilters) {
      expect(filters).toContainEqual(['form_id', 'f1'])
    }
  })
})

describe('GET /api/forms/[id]/analytics — gate de plano', () => {
  it('plano Plus recebe plan_gated=false e uma linha por pergunta', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ plan: 'plus' }) as never)
    const body = await (await GET(req, params)).json()
    expect(body.plan_gated).toBe(false)
    expect(body.abandonment_by_question).toHaveLength(QUESTIONS.length)
  })

  it('plano Free recebe plan_gated=true e zero abandono (dado não vaza)', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabase({ plan: 'free', incomplete: [{ last_question_answered: 'q2' }] }) as never
    )
    const body = await (await GET(req, params)).json()
    expect(body.plan_gated).toBe(true)
    expect(body.abandonment_by_question.every((r: { abandoned_count: number }) => r.abandoned_count === 0)).toBe(true)
  })

  it('exige autenticação', async () => {
    const sb = makeSupabase()
    sb.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
    mockCreateClient.mockResolvedValue(sb as never)
    expect((await GET(req, params)).status).toBe(401)
  })
})
