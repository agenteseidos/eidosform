import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSignedUploadUrl = vi.fn()
const formSingle = vi.fn()

vi.mock('@/lib/response-rate-limit', () => ({
  // A rota deixou de gastar o balde do SUBMIT (`resp:${ip}`, 10/min) e passou a ter orçamento
  // próprio: pré-filtro por IP antes do parse do corpo + teto por IP+form depois.
  // (auditoria 2026-08, lote 2 · gêmea do L2-4)
  checkUploadSignPreflightAsync: vi.fn(async () => ({ allowed: true, remaining: 39, resetIn: 0 })),
  checkUploadSignRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 19, resetIn: 0 })),
  checkResponseRateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 0 })),
}))
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ single: formSingle }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => ({
    // A ficha do anexo (form_files) nasce aqui desde 16/08 — é ela que permite provar depois
    // que o arquivo é DESTE formulário e DESTA pergunta, e revogar/apagar de verdade.
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'file-teste' }, error: null }) }) }),
    }),
    storage: {
      from: () => ({ createSignedUploadUrl }),
    },
  }),
}))

import { POST } from './route'

const FORM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/upload/sign-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  formSingle.mockResolvedValue({
    data: {
      id: FORM_ID,
      user_id: 'owner-1',
      status: 'published',
      questions: [{ id: 'upload-1', type: 'file_upload', maxFileSize: 2 }],
    },
    error: null,
  })
  createSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.test', token: 'token' },
    error: null,
  })
})

describe('POST /api/upload/sign-url', () => {
  it('exige question_id', async () => {
    const res = await POST(request({ form_id: FORM_ID, mime: 'application/pdf', size: 10 }))
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('recusa pergunta inexistente ou de outro tipo', async () => {
    let res = await POST(request({
      form_id: FORM_ID, question_id: 'other', mime: 'application/pdf', size: 10,
    }))
    expect(res.status).toBe(400)

    formSingle.mockResolvedValueOnce({
      data: {
        id: FORM_ID,
        user_id: 'owner-1',
        status: 'published',
        questions: [{ id: 'upload-1', type: 'short_text' }],
      },
      error: null,
    })
    res = await POST(request({
      form_id: FORM_ID, question_id: 'upload-1', mime: 'application/pdf', size: 10,
    }))
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('aplica o limite da pergunta antes de assinar', async () => {
    const res = await POST(request({
      form_id: FORM_ID,
      question_id: 'upload-1',
      mime: 'application/pdf',
      size: 3 * 1024 * 1024,
    }))
    expect(res.status).toBe(400)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('aceita wildcard image/* configurado pela pergunta', async () => {
    formSingle.mockResolvedValueOnce({
      data: {
        id: FORM_ID,
        user_id: 'owner-1',
        status: 'published',
        questions: [{
          id: 'upload-1',
          type: 'file_upload',
          allowedFileTypes: ['image/*', 'application/pdf'],
        }],
      },
      error: null,
    })
    const res = await POST(request({
      form_id: FORM_ID,
      question_id: 'upload-1',
      mime: 'image/jpeg',
      size: 1024,
    }))
    expect(res.status).toBe(200)
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('assina somente caminho pertencente ao dono/form válidos', async () => {
    const res = await POST(request({
      form_id: FORM_ID,
      question_id: 'upload-1',
      mime: 'application/pdf',
      size: 1024,
    }))
    expect(res.status).toBe(200)
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1)
    expect(createSignedUploadUrl.mock.calls[0][0]).toMatch(
      new RegExp(`^owner-1/${FORM_ID}/[0-9a-f-]+\\.pdf$`)
    )
  })
})

describe('🛡️ o navegador recebe REFERÊNCIA, não endereço (16/08)', () => {
  it('devolve file_id e NÃO devolve mais public_url', async () => {
    // Antes a rota devolvia a URL pública do bucket e o player a gravava direto na resposta.
    // Isso deixava o endereço nas mãos do cliente — que podia trocá-lo pelo de outro formulário
    // (o validador só conferia o prefixo). Agora quem monta a URL é o servidor, na gravação.
    formSingle.mockResolvedValue({
      data: { id: 'form-1', user_id: 'user-1', questions: [{ id: 'q1', type: 'file_upload' }] },
      error: null,
    })
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage/assinada', token: 'tok' }, error: null,
    })

    const res = await POST(request({ form_id: 'form-1', mime: 'application/pdf', size: 1000, question_id: 'q1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.file_id).toBe('file-teste')
    expect(body.public_url).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('/storage/v1/object/public/')
  })
})
