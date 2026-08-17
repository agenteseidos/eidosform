/**
 * O crachá do anexo. O que importa aqui não é "assina e valida" — é o que ele NÃO carrega e o
 * que a versão consegue matar.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { assinarFileToken, lerFileToken, urlDoArquivo } from './file-link-token'

const FILE = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  process.env.FILE_LINK_SECRET = 'segredo-dedicado-de-teste'
  process.env.NEXT_PUBLIC_APP_URL = 'https://eidosform.com.br'
})

describe('crachá do anexo', () => {
  it('assina e relê', () => {
    const t = assinarFileToken(FILE, 1)!
    expect(lerFileToken(t)).toEqual({ ok: true, fileId: FILE, versao: 1 })
  })

  it('🛡️ NÃO carrega caminho, dono nem nome — só o que o banco vai resolver', () => {
    // Foi a correção central do parecer: embutir o dono no link quebra em transferência de
    // formulário, e embutir o caminho impede revogar/expirar.
    const t = assinarFileToken(FILE, 1)!
    const claro = Buffer.from(t.split('.')[0], 'base64url').toString('utf8')
    expect(claro).toBe(`v1.${FILE}.1`)
    expect(claro).not.toMatch(/form-uploads|assets|\.pdf|user/i)
  })

  it('🛡️ token adulterado é recusado', () => {
    const t = assinarFileToken(FILE, 1)!
    const [corpo, assin] = t.split('.')
    const outro = Buffer.from(`v1.22222222-2222-4222-8222-222222222222.1`, 'utf8').toString('base64url')
    expect(lerFileToken(`${outro}.${assin}`)).toEqual({ ok: false, motivo: 'assinatura' })
    expect(lerFileToken(`${corpo}.xxxx`)).toEqual({ ok: false, motivo: 'assinatura' })
  })

  it('🛡️ a VERSÃO viaja no token — é ela que mata link já distribuído', () => {
    // Trocar o formulário de "qualquer pessoa com o link" para "somente eu" incrementa a versão
    // no banco; o link antigo continua íntegro mas passa a apontar para uma versão que não existe
    // mais, e a rota recusa. Sem varrer planilha, sem mover arquivo.
    const antigo = lerFileToken(assinarFileToken(FILE, 1)!)
    const novo = lerFileToken(assinarFileToken(FILE, 2)!)
    expect(antigo).toMatchObject({ versao: 1 })
    expect(novo).toMatchObject({ versao: 2 })
    expect(assinarFileToken(FILE, 1)).not.toBe(assinarFileToken(FILE, 2))
  })

  it('🛡️ segredo DEDICADO: sem ele não assina, mesmo com os outros presentes', () => {
    const salvo = process.env.FILE_LINK_SECRET
    try {
      delete process.env.FILE_LINK_SECRET
      process.env.INTERNAL_API_SECRET = 'nao-deve-servir'
      process.env.PAYMENT_LINK_TOKEN_SECRET = 'nao-deve-servir'
      expect(assinarFileToken(FILE, 1)).toBeNull()
      expect(urlDoArquivo(FILE, 1)).toBeNull()
    } finally {
      process.env.FILE_LINK_SECRET = salvo
    }
  })

  it('a URL é a nossa, permanente e sem dado do arquivo', () => {
    const u = urlDoArquivo(FILE, 1)!
    expect(u.startsWith('https://eidosform.com.br/arquivo/')).toBe(true)
    expect(u).not.toContain('supabase')
  })
})
