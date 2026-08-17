/**
 * A prova de que o anexo é DESTE formulário.
 *
 * O buraco fechado aqui é ANTERIOR ao redesenho: o validador só conferia o prefixo do bucket, e
 * como o bucket é UM para todos os clientes, dava para gravar o anexo de um formulário como
 * resposta de outro. Trocar o prefixo público pelo nosso não corrigiria isso.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))

import { reivindicarAnexos } from './form-file-claim'

const FORM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OUTRO_FORM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** Banco falso: devolve as fichas pedidas e registra os updates. */
function makeDb(fichas: Array<Record<string, unknown>>, updates: unknown[] = []) {
  return {
    from(tabela: string) {
      const b: Record<string, unknown> = {}
      const chain = () => b
      b.select = chain; b.eq = chain
      b.in = async () => ({ data: fichas, error: null })
      b.update = (v: unknown) => { updates.push(v); return { in: async () => ({ error: null }), eq: async () => ({ error: null }) } }
      b.maybeSingle = async () => ({
        data: tabela === 'forms' ? { file_access_version: 3 } : null, error: null,
      })
      return b
    },
  } as never
}

beforeEach(() => {
  process.env.FILE_LINK_SECRET = 'segredo-de-teste'
  process.env.NEXT_PUBLIC_APP_URL = 'https://eidosform.com.br'
})

describe('reivindicarAnexos', () => {
  it('vínculo correto → grava com a URL montada pelo SERVIDOR, na versão atual do formulário', async () => {
    const db = makeDb([{ id: FILE, form_id: FORM, question_id: 'q1', status: 'pending', revoked_at: null }])
    const r = await reivindicarAnexos(db, {
      formId: FORM, responseId: 'resp1',
      answers: { q1: { name: 'cv.pdf', type: 'application/pdf', size: 10, file_id: FILE } },
    })
    const anexo = r.q1 as Record<string, unknown>
    expect(anexo.file_id).toBe(FILE)
    expect(String(anexo.url)).toContain('https://eidosform.com.br/arquivo/')
    // versão 3 vem do formulário — não do que o navegador mandou
    const corpo = String(anexo.url).split('/arquivo/')[1].split('.')[0]
    expect(Buffer.from(corpo, 'base64url').toString()).toBe(`v1.${FILE}.3`)
  })

  it('🛡️ arquivo de OUTRO formulário é REMOVIDO da resposta', async () => {
    // O ataque real: pegar o endereço de um anexo alheio e gravá-lo como resposta minha.
    const db = makeDb([{ id: FILE, form_id: OUTRO_FORM, question_id: 'q1', status: 'claimed', revoked_at: null }])
    const r = await reivindicarAnexos(db, {
      formId: FORM, responseId: 'resp1',
      answers: { q1: { name: 'alheio.pdf', file_id: FILE }, q2: 'texto normal' },
    })
    expect(r.q1).toBeUndefined()
    expect(r.q2).toBe('texto normal') // o resto da resposta é preservado
  })

  it('🛡️ arquivo de outra PERGUNTA do mesmo formulário também é recusado', async () => {
    const db = makeDb([{ id: FILE, form_id: FORM, question_id: 'q9', status: 'ready', revoked_at: null }])
    const r = await reivindicarAnexos(db, {
      formId: FORM, responseId: 'r', answers: { q1: { name: 'x.pdf', file_id: FILE } },
    })
    expect(r.q1).toBeUndefined()
  })

  it('🛡️ ficha revogada não vira anexo', async () => {
    const db = makeDb([{ id: FILE, form_id: FORM, question_id: 'q1', status: 'ready', revoked_at: '2026-08-16T00:00:00Z' }])
    const r = await reivindicarAnexos(db, {
      formId: FORM, responseId: 'r', answers: { q1: { name: 'x.pdf', file_id: FILE } },
    })
    expect(r.q1).toBeUndefined()
  })

  it('🛡️ ficha inexistente não vira anexo', async () => {
    const db = makeDb([])
    const r = await reivindicarAnexos(db, {
      formId: FORM, responseId: 'r', answers: { q1: { name: 'x.pdf', file_id: 'inventado' } },
    })
    expect(r.q1).toBeUndefined()
  })

  it('resposta sem anexo passa intacta (caminho comum, sem ida ao banco)', async () => {
    const db = makeDb([])
    const answers = { q1: 'texto', q2: 42 }
    expect(await reivindicarAnexos(db, { formId: FORM, responseId: 'r', answers })).toEqual(answers)
  })
})

describe('🛡️ falha de INFRA ≠ ataque (parecer Codex, 16/08)', () => {
  it('erro ao consultar a ficha LANÇA, em vez de apagar o anexo em silêncio', async () => {
    // Antes eu tratava os dois igual: apagava o anexo. Mas um soluço de banco não torna o
    // documento do lead suspeito — descartá-lo gravava resposta incompleta com 200, e o lead
    // via "enviado". Lançando, o submit devolve 503 retentável.
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({}), in: async () => ({ data: null, error: { message: 'conexão caiu' } }) }),
      }),
    } as never
    await expect(reivindicarAnexos(db, {
      formId: FORM, responseId: null, answers: { q1: { name: 'x.pdf', file_id: FILE } },
    })).rejects.toThrow(/falha ao conferir anexo/)
  })
})

describe('🛡️ vincularAnexosAResposta — a purga por resposta precisa achar o arquivo', () => {
  it('grava o response_id nas fichas dos anexos da resposta', async () => {
    // No submit, a prova do vínculo acontece ANTES de a resposta existir, então `response_id`
    // nascia nulo e nunca era preenchido: a purga por resposta jamais acharia o arquivo.
    const updates: unknown[] = []
    const db = {
      from: () => ({
        update: (v: unknown) => { updates.push(v); return { in: async () => ({ error: null }) } },
      }),
    } as never
    const { vincularAnexosAResposta } = await import('./form-file-claim')
    await vincularAnexosAResposta(db, {
      answers: { q1: { name: 'x.pdf', file_id: FILE }, q2: 'texto' },
      responseId: 'resp-99',
    })
    expect(updates).toEqual([{ response_id: 'resp-99' }])
  })
})

describe('🛡️ nome do arquivo — o cliente baixa "curriculo.pdf", não um UUID', () => {
  it('grava o nome original na ficha', async () => {
    // Antes o campo nunca era preenchido (o update mandava `undefined`, que o JSON descarta),
    // então o Content-Disposition caía no basename do objeto: um UUID.
    const updates: Array<Record<string, unknown>> = []
    const db = {
      from: () => {
        const b: Record<string, unknown> = {}
        b.select = () => b; b.eq = () => b
        b.in = async () => ({ data: [{ id: FILE, form_id: FORM, question_id: 'q1', status: 'pending', revoked_at: null }], error: null })
        b.maybeSingle = async () => ({ data: { file_access_version: 1 }, error: null })
        b.update = (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }), in: async () => ({ error: null }) } }
        return b
      },
    } as never
    await reivindicarAnexos(db, {
      formId: FORM, responseId: 'r1', answers: { q1: { name: 'currículo final.pdf', file_id: FILE } },
    })
    expect(updates.some((u) => u.original_name === 'currículo final.pdf')).toBe(true)
  })

  it('🛡️ higieniza o que quebraria o cabeçalho ou a query (o nome vem do respondente)', async () => {
    const updates: Array<Record<string, unknown>> = []
    const db = {
      from: () => {
        const b: Record<string, unknown> = {}
        b.select = () => b; b.eq = () => b
        b.in = async () => ({ data: [{ id: FILE, form_id: FORM, question_id: 'q1', status: 'pending', revoked_at: null }], error: null })
        b.maybeSingle = async () => ({ data: { file_access_version: 1 }, error: null })
        b.update = (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }), in: async () => ({ error: null }) } }
        return b
      },
    } as never
    await reivindicarAnexos(db, {
      formId: FORM, responseId: 'r1',
      answers: { q1: { name: 'a"b&x=1\n#c.pdf', file_id: FILE } },
    })
    const nome = String(updates.find((u) => 'original_name' in u)?.original_name ?? '')
    expect(nome).not.toMatch(/["&#\n\r]/)
    expect(nome).toContain('.pdf')
  })
})
