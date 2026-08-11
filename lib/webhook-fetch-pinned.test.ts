/**
 * E08-S1-008 · pino de IP — a defesa contra DNS rebinding no webhook.
 *
 * `validateWebhookUrlAsync` resolve o domínio e recusa IP privado, mas quem conecta é o `fetch`,
 * que resolve DE NOVO. Entre a checagem e a conexão cabe um domínio que responde IP público na
 * validação e IP interno na hora de conectar. Este lookup fecha a janela: confere o endereço no
 * instante da conexão, e um endereço interno impede o socket de abrir.
 *
 * O lookup é testado direto (e não através de uma conexão real) porque ele É a regra inteira.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => dnsMock)
vi.mock('@/lib/logger', () => ({ logWarn: vi.fn(), logError: vi.fn(), log: vi.fn() }))

import { lookupQueRecusaInterno, EnderecoInternoBloqueado, criarDispatcherComPino } from './webhook-fetch-pinned'

/** Faz o dns responder a lista pedida. */
function dnsResponde(enderecos: Array<{ address: string; family: number }>) {
  dnsMock.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: unknown, a?: unknown) => void) => {
    cb(null, enderecos)
  })
}

const chamar = (hostname: string, options: unknown = {}) =>
  new Promise<{ err: unknown; address?: unknown; family?: unknown }>((resolve) => {
    lookupQueRecusaInterno(hostname, options, (err, address, family) => resolve({ err, address, family }))
  })

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('endereço PÚBLICO passa', () => {
  it('devolve o primeiro endereço no formato que o undici espera', async () => {
    dnsResponde([{ address: '203.0.113.10', family: 4 }])
    const r = await chamar('crm.cliente.com')
    expect(r.err).toBeNull()
    expect(r.address).toBe('203.0.113.10')
    expect(r.family).toBe(4)
  })

  it('com all:true devolve a lista inteira', async () => {
    dnsResponde([{ address: '203.0.113.10', family: 4 }, { address: '198.51.100.7', family: 4 }])
    const r = await chamar('crm.cliente.com', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toHaveLength(2)
  })
})

describe('🛡️ endereço INTERNO é bloqueado na hora da conexão', () => {
  it.each([
    ['metadata da nuvem', '169.254.169.254'],
    ['loopback', '127.0.0.1'],
    ['rede privada 10.x', '10.0.0.5'],
    ['rede privada 192.168.x', '192.168.1.10'],
    ['rede privada 172.16-31', '172.20.0.9'],
    ['CGNAT', '100.100.0.1'],
  ])('%s → recusa', async (_nome, ip) => {
    dnsResponde([{ address: ip, family: 4 }])
    const r = await chamar('malicioso.com')
    expect(r.err).toBeInstanceOf(EnderecoInternoBloqueado)
  })

  it('lista MISTA (público + interno) reprova o host inteiro', async () => {
    // Escolher "só os públicos" deixaria o atacante controlar a escolha do Node numa lista
    // mista — a regra é `some`, nunca `filter`.
    dnsResponde([{ address: '203.0.113.10', family: 4 }, { address: '169.254.169.254', family: 4 }])
    const r = await chamar('rebinding.com')
    expect(r.err).toBeInstanceOf(EnderecoInternoBloqueado)
  })

  it('IP público de faixa vizinha da CGNAT continua passando (100.0.x é público)', async () => {
    // A auditoria já pagou esse preço uma vez: marcar 100.0.0.0/8 inteiro como privado
    // bloquearia webhook legítimo de cliente.
    dnsResponde([{ address: '100.20.30.40', family: 4 }])
    expect((await chamar('cliente-real.com')).err).toBeNull()
  })
})

describe('falhas do DNS', () => {
  it('erro de resolução é propagado como veio', async () => {
    const erro = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    dnsMock.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: unknown) => void) => cb(erro))
    expect((await chamar('nao-existe.com')).err).toBe(erro)
  })

  it('lista VAZIA não vira "sem restrição" — vira erro', async () => {
    dnsResponde([])
    const r = await chamar('vazio.com') as { err: { code?: string } }
    expect(r.err).toBeTruthy()
    expect(r.err.code).toBe('ENOTFOUND')
  })
})

describe('degradação deliberada', () => {
  it('o dispatcher existe neste runtime (Node) — o pino está de fato ativo', () => {
    expect(criarDispatcherComPino()).not.toBeNull()
  })
})
