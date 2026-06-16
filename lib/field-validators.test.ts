import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateFieldValue, validateAllAnswers, pruneOrphanAnswers } from './field-validators'
import type { QuestionConfig } from './database.types'

// Cobertura do contrato de validação backend por tipo de campo — os caminhos
// que protegem o /api/responses e o /api/v1 de dados malformados.

const q = (type: string, extra: Partial<QuestionConfig> = {}): QuestionConfig =>
  ({ id: 'q1', type, title: 'Pergunta', ...extra } as QuestionConfig)

describe('validateFieldValue — campos vazios', () => {
  it('aceita undefined/null/"" (obrigatoriedade é checada à parte)', () => {
    expect(validateFieldValue(q('email'), undefined).valid).toBe(true)
    expect(validateFieldValue(q('email'), null).valid).toBe(true)
    expect(validateFieldValue(q('email'), '').valid).toBe(true)
  })
})

describe('texto', () => {
  it('aceita string normal e rejeita não-string', () => {
    expect(validateFieldValue(q('short_text'), 'olá').valid).toBe(true)
    expect(validateFieldValue(q('long_text'), 123).valid).toBe(false)
    expect(validateFieldValue(q('short_text'), { x: 1 }).valid).toBe(false)
  })
  it('rejeita texto acima de 10.000 chars', () => {
    expect(validateFieldValue(q('long_text'), 'a'.repeat(10_001)).valid).toBe(false)
    expect(validateFieldValue(q('long_text'), 'a'.repeat(10_000)).valid).toBe(true)
  })
})

describe('email / url / phone', () => {
  it('valida formato de email', () => {
    expect(validateFieldValue(q('email'), 'a@b.co').valid).toBe(true)
    expect(validateFieldValue(q('email'), 'sem-arroba').valid).toBe(false)
    expect(validateFieldValue(q('email'), 'a@b').valid).toBe(false)
  })
  it('valida URL', () => {
    expect(validateFieldValue(q('url'), 'https://eidosform.com.br').valid).toBe(true)
    expect(validateFieldValue(q('url'), 'isto não é url').valid).toBe(false)
  })
  it('valida telefone', () => {
    expect(validateFieldValue(q('phone'), '+55 11 98888-7777').valid).toBe(true)
    expect(validateFieldValue(q('phone'), 'abc').valid).toBe(false)
  })
})

describe('number / ranges', () => {
  it('number aceita número e rejeita texto', () => {
    expect(validateFieldValue(q('number'), 42).valid).toBe(true)
    expect(validateFieldValue(q('number'), 'quarenta e dois').valid).toBe(false)
  })
  it('rating respeita min/max da pergunta', () => {
    const rating = q('rating', { minValue: 1, maxValue: 5 })
    expect(validateFieldValue(rating, 5).valid).toBe(true)
    expect(validateFieldValue(rating, 6).valid).toBe(false)
    expect(validateFieldValue(rating, 0).valid).toBe(false)
  })
  it('rating com config invertida (min >= max) é rejeitado', () => {
    expect(validateFieldValue(q('rating', { minValue: 5, maxValue: 1 }), 3).valid).toBe(false)
  })
  it('nps é fixo 0–10', () => {
    expect(validateFieldValue(q('nps'), 0).valid).toBe(true)
    expect(validateFieldValue(q('nps'), 10).valid).toBe(true)
    expect(validateFieldValue(q('nps'), 11).valid).toBe(false)
  })
  it('opinion_scale respeita min/max', () => {
    const scale = q('opinion_scale', { minValue: 1, maxValue: 10 })
    expect(validateFieldValue(scale, 10).valid).toBe(true)
    expect(validateFieldValue(scale, 11).valid).toBe(false)
  })
})

describe('escolhas (dropdown / checkboxes)', () => {
  const opts = ['Google', 'Indicação']
  it('dropdown só aceita opção da lista (sem allowOther)', () => {
    expect(validateFieldValue(q('dropdown', { options: opts }), 'Google').valid).toBe(true)
    expect(validateFieldValue(q('dropdown', { options: opts }), 'Inventada').valid).toBe(false)
  })
  it('dropdown com allowOther aceita texto livre', () => {
    expect(validateFieldValue(q('dropdown', { options: opts, allowOther: true }), 'Outra coisa').valid).toBe(true)
  })
  it('checkboxes valida cada item contra a lista', () => {
    expect(validateFieldValue(q('checkboxes', { options: opts }), ['Google']).valid).toBe(true)
    expect(validateFieldValue(q('checkboxes', { options: opts }), ['Google', 'Forjada']).valid).toBe(false)
  })
})

describe('cpf', () => {
  it('aceita CPF válido (dígito verificador) e rejeita inválido', () => {
    // 529.982.247-25 é um CPF de teste estruturalmente válido
    expect(validateFieldValue(q('cpf'), '529.982.247-25').valid).toBe(true)
    expect(validateFieldValue(q('cpf'), '111.111.111-11').valid).toBe(false)
    expect(validateFieldValue(q('cpf'), '123').valid).toBe(false)
  })

  it('aceita CNPJ válido (dígito verificador) e rejeita inválido', () => {
    // 11.222.333/0001-81 é um CNPJ de teste estruturalmente válido
    expect(validateFieldValue(q('cpf'), '11.222.333/0001-81').valid).toBe(true)
    expect(validateFieldValue(q('cpf'), '11.111.111/1111-11').valid).toBe(false)
    // 12 ou 13 dígitos não são nem CPF nem CNPJ
    expect(validateFieldValue(q('cpf'), '1234567890123').valid).toBe(false)
  })
})

describe('file_upload — regressão P1-4 (prefixo do bucket)', () => {
  const SUPA = 'https://example.supabase.co'
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA })
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl
  })

  const bucketUrl = `${SUPA}/storage/v1/object/public/form-uploads/user/form/x.pdf`

  it('aceita URL do bucket form-uploads', () => {
    expect(validateFieldValue(q('file_upload'), { name: 'x.pdf', url: bucketUrl }).valid).toBe(true)
  })
  it('REJEITA URL https externa (o bug P1-4 aceitava qualquer https)', () => {
    expect(validateFieldValue(q('file_upload'), { name: 'x.pdf', url: 'https://evil.example.com/x.pdf' }).valid).toBe(false)
    expect(validateFieldValue(q('file_upload'), { name: 'x.pdf', url: 'http://evil.example.com/x.pdf' }).valid).toBe(false)
  })
  it('rejeita objeto sem name/url', () => {
    expect(validateFieldValue(q('file_upload'), { url: bucketUrl }).valid).toBe(false)
    expect(validateFieldValue(q('file_upload'), 'só-string').valid).toBe(false)
  })
  it('aplica maxFileSize da pergunta (cap 25MB)', () => {
    const file = (mb: number) => ({ name: 'x.pdf', url: bucketUrl, size: mb * 1024 * 1024 })
    expect(validateFieldValue(q('file_upload', { maxFileSize: 2 }), file(1)).valid).toBe(true)
    expect(validateFieldValue(q('file_upload', { maxFileSize: 2 }), file(3)).valid).toBe(false)
    // maxFileSize configurado acima do teto: 25MB prevalece
    expect(validateFieldValue(q('file_upload', { maxFileSize: 100 }), file(26)).valid).toBe(false)
  })
})

describe('tipos apresentacionais e desconhecidos', () => {
  it('html_block sempre passa (não captura valor)', () => {
    expect(validateFieldValue(q('html_block'), '<script>x</script>').valid).toBe(true)
  })
  it('tipo desconhecido passa (forward-compat)', () => {
    expect(validateFieldValue(q('tipo_futuro_xyz'), 'qualquer').valid).toBe(true)
  })
})

describe('validateAllAnswers / pruneOrphanAnswers', () => {
  const questions = [
    q('email', { id: 'e1' }),
    q('number', { id: 'n1' }),
  ]

  it('acumula erros por pergunta', () => {
    const errs = validateAllAnswers(questions, { e1: 'inválido', n1: 'não-número' })
    expect(errs).toHaveLength(2)
    expect(errs.map(e => e.questionId).sort()).toEqual(['e1', 'n1'])
  })

  it('ignora chave órfã (pergunta deletada pelo dono) em vez de bloquear o submit', () => {
    const errs = validateAllAnswers(questions, { fantasma: '<payload>' })
    expect(errs).toHaveLength(0)
  })

  it('pruneOrphanAnswers separa conhecidas de órfãs', () => {
    const { pruned, removedKeys } = pruneOrphanAnswers(questions, {
      e1: 'a@b.co',
      fantasma: 'lixo',
    })
    expect(Object.keys(pruned)).toEqual(['e1'])
    expect(removedKeys).toEqual(['fantasma'])
  })
})
