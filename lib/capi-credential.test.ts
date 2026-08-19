import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * O cofre do token de CAPI.
 *
 * O que estes testes protegem: o token do cliente é uma credencial que injeta evento na conta de
 * anúncios DELE. Se a cifragem quebrar em silêncio — chave errada, blob adulterado, formato
 * mudado — o sintoma seria "o CAPI parou de funcionar", não "o cofre está aberto". Por isso cada
 * modo de falha tem teste: o cofre precisa recusar de forma VISÍVEL, nunca devolver lixo.
 */

const CHAVE = 'a'.repeat(64)   // 32 bytes em hex
const OUTRA = 'b'.repeat(64)
const FORM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OUTRO_FORM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function carregar() {
  const mod = await import('./capi-credential')
  return mod
}

describe('cofre do token de CAPI', () => {
  beforeEach(() => { process.env.META_CAPI_ENC_KEY = CHAVE })
  afterEach(() => { delete process.env.META_CAPI_ENC_KEY })

  it('cifra e decifra de volta o mesmo token', async () => {
    const { cifrarToken, decifrarToken } = await carregar()
    const token = 'EAAG' + 'x'.repeat(180)
    const blob = cifrarToken(token, FORM)
    expect(blob).toBeTruthy()
    // O token não aparece em claro dentro do blob — é o mínimo que "cifrado" tem de significar.
    expect(blob).not.toContain(token)
    expect(decifrarToken(blob, FORM)).toBe(token)
  })

  it('duas cifragens do MESMO token dão blobs diferentes', async () => {
    // IV novo a cada cifragem. Se isto falhar, alguém fixou o IV — e em GCM repetir (chave, IV)
    // destrói a garantia do modo.
    const { cifrarToken } = await carregar()
    expect(cifrarToken('mesmo-token-aqui', FORM)).not.toBe(cifrarToken('mesmo-token-aqui', FORM))
  })

  it('sem a chave no ambiente, NÃO cifra e NÃO decifra', async () => {
    // Sem fallback para segredo genérico, de propósito: o save é recusado e o erro aparece.
    delete process.env.META_CAPI_ENC_KEY
    const { cifrarToken, decifrarToken, cofreConfigurado } = await carregar()
    expect(cofreConfigurado()).toBe(false)
    expect(cifrarToken('qualquer-coisa', FORM)).toBeNull()
    expect(decifrarToken('v1.aa.bb.cc', FORM)).toBeNull()
  })

  it('chave malformada é tratada como chave ausente', async () => {
    process.env.META_CAPI_ENC_KEY = 'chave-curta-demais'
    const { cofreConfigurado, cifrarToken } = await carregar()
    expect(cofreConfigurado()).toBe(false)
    expect(cifrarToken('token', FORM)).toBeNull()
  })

  it('blob adulterado no banco NÃO decifra — a tag de autenticação pega', async () => {
    const { cifrarToken, decifrarToken } = await carregar()
    const blob = cifrarToken('token-original-do-cliente', FORM)!
    const partes = blob.split('.')
    // Vira um bit do texto cifrado.
    const corrompido = [partes[0], partes[1], partes[2], Buffer.from(
      Buffer.from(partes[3], 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)),
    ).toString('base64')].join('.')
    expect(decifrarToken(corrompido, FORM)).toBeNull()
  })

  it('blob cifrado com OUTRA chave não decifra', async () => {
    const { cifrarToken } = await carregar()
    const blob = cifrarToken('token-do-cliente', FORM)!
    process.env.META_CAPI_ENC_KEY = OUTRA
    const { decifrarToken } = await import('./capi-credential')
    expect(decifrarToken(blob, FORM)).toBeNull()
  })

  it('formato desconhecido devolve null em vez de lançar', async () => {
    // Isto roda no caminho do submit: lançar aqui derrubaria o envio do lead.
    const { decifrarToken } = await carregar()
    for (const lixo of ['', 'abc', 'v2.a.b.c', 'v1.a.b', 'v1...', null, undefined]) {
      expect(decifrarToken(lixo as string, FORM)).toBeNull()
    }
  })

  it('blob de OUTRO formulário não decifra — o vínculo entra na autenticação', async () => {
    // Sem isto, quem escrevesse no banco moveria a credencial de um cliente para o formulário de
    // outro e passaria a mandar evento com o token alheio.
    const { cifrarToken, decifrarToken } = await carregar()
    const blob = cifrarToken('token-do-cliente-a', FORM)!
    expect(decifrarToken(blob, FORM)).toBe('token-do-cliente-a')
    expect(decifrarToken(blob, OUTRO_FORM)).toBeNull()
  })

  it('sem vínculo não cifra nem decifra', async () => {
    const { cifrarToken, decifrarToken } = await carregar()
    expect(cifrarToken('token', '')).toBeNull()
    const blob = cifrarToken('token', FORM)!
    expect(decifrarToken(blob, '')).toBeNull()
  })

  it('a dica mostra só os 4 últimos caracteres', async () => {
    const { dicaDoToken } = await carregar()
    expect(dicaDoToken('EAAGabcdefgh1234')).toBe('••••1234')
    // Token curto não vira dica que entrega o token inteiro.
    expect(dicaDoToken('ab')).toBe('••••')
  })
})
