import { describe, it, expect } from 'vitest'
import { sanitizeUrlParams, extractUrlParamsFromSearch, URL_PARAMS_MAX_KEYS } from './url-params'

describe('sanitizeUrlParams', () => {
  it('aceita objeto simples de identidade', () => {
    expect(sanitizeUrlParams({ nome: 'Sidney Medeiros', email: 'x@y.com', telefone: '5583999990000' }))
      .toEqual({ nome: 'Sidney Medeiros', email: 'x@y.com', telefone: '5583999990000' })
  })

  it('descarta utm_* e denylist, case-insensitive', () => {
    expect(sanitizeUrlParams({ UTM_SOURCE: 'x', FbClId: 'abc', mcp_token: 'jwt', email: 'a@b.com' }))
      .toEqual({ email: 'a@b.com' })
  })

  it('normaliza chaves para minúsculas', () => {
    expect(sanitizeUrlParams({ NOME: 'Ana', 'Telefone': '83999' }))
      .toEqual({ nome: 'Ana', telefone: '83999' })
  })

  it('bloqueia chaves de prototype pollution', () => {
    const out = sanitizeUrlParams({ ['__proto__']: 'x', constructor: 'y', prototype: 'z', ok: '1' })
    expect(out).toEqual({ ok: '1' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype) // objeto plano seguro
  })

  it('descarta chave com valor acima de 200 chars (não trunca)', () => {
    expect(sanitizeUrlParams({ hack: 'x'.repeat(201), email: 'a@b.com' }))
      .toEqual({ email: 'a@b.com' })
  })

  it('descarta chaves fora do regex e valores vazios', () => {
    expect(sanitizeUrlParams({ 'chave inválida!': 'x', 'ok-1_a': 'v', vazio: '  ' }))
      .toEqual({ 'ok-1_a': 'v' })
  })

  it('respeita máximo de 10 chaves válidas (após filtros)', () => {
    const input: Record<string, string> = { utm_source: 'x', fbclid: 'y' }
    for (let i = 0; i < 15; i++) input[`k${i}`] = `v${i}`
    const out = sanitizeUrlParams(input)!
    expect(Object.keys(out)).toHaveLength(URL_PARAMS_MAX_KEYS)
    expect(out.k0).toBe('v0')
  })

  it('não itera payloads gigantes inteiros (cap de 50 entradas brutas)', () => {
    const input: Record<string, string> = {}
    for (let i = 0; i < 60; i++) input[`junk-key-${'x'.repeat(50)}-${i}`] = 'v' // chaves >40 chars, inválidas
    input.email = 'a@b.com' // entra depois da posição 50 — fora da janela inspecionada
    expect(sanitizeUrlParams(input)).toBeNull()
  })

  it('devolve null pra entrada vazia/inválida', () => {
    expect(sanitizeUrlParams(null)).toBeNull()
    expect(sanitizeUrlParams('str')).toBeNull()
    expect(sanitizeUrlParams([])).toBeNull()
    expect(sanitizeUrlParams({})).toBeNull()
    expect(sanitizeUrlParams({ utm_source: 'só utm' })).toBeNull()
  })

  it('valor com cara de fórmula/HTML é ARMAZENADO como texto (proteção é na exibição/célula)', () => {
    expect(sanitizeUrlParams({ nome: '=HYPERLINK("x")', obs: '<script>a</script>' }))
      .toEqual({ nome: '=HYPERLINK("x")', obs: '<script>a</script>' })
  })
})

describe('extractUrlParamsFromSearch', () => {
  it('extrai do search string real (com ?)', () => {
    expect(extractUrlParamsFromSearch('?nome=Sidney+Medeiros&email=sidney%40institutoeidos.com.br&telefone=83999376704&utm_source=fb'))
      .toEqual({ nome: 'Sidney Medeiros', email: 'sidney@institutoeidos.com.br', telefone: '83999376704' })
  })

  it('chave repetida: vence a ÚLTIMA', () => {
    expect(extractUrlParamsFromSearch('?email=a%40b.com&email=c%40d.com'))
      .toEqual({ email: 'c@d.com' })
  })

  it('só utm/tracking → null', () => {
    expect(extractUrlParamsFromSearch('?utm_source=fb&utm_medium=cpc&fbclid=xyz')).toBeNull()
    expect(extractUrlParamsFromSearch('')).toBeNull()
  })
})
