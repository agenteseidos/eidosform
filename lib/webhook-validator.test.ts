/**
 * Validação de URL de webhook — SSRF (auditoria 2026-08, lote 3 · L3-3).
 *
 * Este arquivo NÃO existia: `webhook-validator.ts` e `webhook-dispatcher.ts` estavam sem
 * cobertura, o que explica como o defeito abaixo sobreviveu.
 *
 * DOIS defeitos, e a ORDEM de correção importava:
 *  · `every` liberava a URL se UM dos IPs resolvidos fosse público — um domínio com múltiplos
 *    registros A (um público, um apontando para 169.254.169.254 ou rede interna) passava.
 *  · `a === 100` marcava TODO o 100.0.0.0/8 como privado, mas CGNAT é só 100.64.0.0/10.
 *    100.0-63.x e 100.128-255.x são espaço público real do ARIN.
 *
 * Corrigir só o `every` teria bloqueado webhook legítimo de cliente em faixa 100.x pública —
 * a correção de segurança viraria perda de lead. Por isso os dois testes convivem aqui.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// O validador faz `await import('dns')` e usa `dns.promises.resolve4` (webhook-validator.ts:29-34),
// então o mock precisa ser do módulo 'dns' com a propriedade `promises` — não de 'dns/promises'.
const resolve4 = vi.fn()
vi.mock('dns', () => ({ promises: { resolve4: (...a: unknown[]) => resolve4(...a) } }))

// Cada teste usa um HOSTNAME único: o validador tem cache de DNS por host
// (`dnsCache`, webhook-validator.ts:8) e reaproveitar o nome mascararia o mock.
let n = 0
const host = () => `h${++n}-teste.exemplo.com`

import { validateWebhookUrlAsync, validateWebhookUrl } from './webhook-validator'

beforeEach(() => {
  resolve4.mockReset()
})

describe('validateWebhookUrl (síncrono, sem DNS)', () => {
  it('aceita https público', () => {
    expect(validateWebhookUrl('https://hooks.zapier.com/x/1').safe).toBe(true)
  })

  it('recusa http, localhost e IP privado literal', () => {
    expect(validateWebhookUrl('http://exemplo.com/hook').safe).toBe(false)
    expect(validateWebhookUrl('https://localhost/hook').safe).toBe(false)
    expect(validateWebhookUrl('https://127.0.0.1/hook').safe).toBe(false)
    expect(validateWebhookUrl('https://10.0.0.5/hook').safe).toBe(false)
    expect(validateWebhookUrl('https://169.254.169.254/latest/meta-data').safe).toBe(false)
  })
})

describe('validateWebhookUrlAsync — resolução de DNS', () => {
  it('L3-3: UM IP privado entre vários REPROVA o conjunto (era `every`, virou `some`)', async () => {
    // O bypass determinístico: registro A duplo, um público de fachada e um interno de verdade.
    resolve4.mockResolvedValue(['93.184.216.34', '169.254.169.254'])
    const r = await validateWebhookUrlAsync(`https://${host()}/hook`)
    expect(r.safe).toBe(false)
    expect(r.reason).toMatch(/private/i)
  })

  it('L3-3: mesmo com a maioria pública, um interno basta para reprovar', async () => {
    resolve4.mockResolvedValue(['93.184.216.34', '1.1.1.1', '10.1.2.3'])
    expect((await validateWebhookUrlAsync(`https://${host()}/hook`)).safe).toBe(false)
  })

  it('aprova quando TODOS os IPs são públicos', async () => {
    resolve4.mockResolvedValue(['93.184.216.34', '1.1.1.1'])
    expect((await validateWebhookUrlAsync(`https://${host()}/hook`)).safe).toBe(true)
  })

  it('L3-3: CGNAT é 100.64.0.0/10 — 100.0-63.x e 100.128+ são PÚBLICOS e devem passar', async () => {
    // Este é o teste que impede a correção de segurança de virar perda de lead. Com o `/8`
    // antigo somado ao `some`, um cliente cujo webhook resolvesse para 100.20.x seria bloqueado.
    for (const ip of ['100.0.0.1', '100.63.255.254', '100.128.0.1', '100.255.255.254']) {
      resolve4.mockResolvedValue([ip])
      const r = await validateWebhookUrlAsync(`https://${host()}/hook`)
      expect(r.safe, `${ip} deveria ser tratado como PÚBLICO`).toBe(true)
    }
  })

  it('L3-3: a faixa CGNAT de verdade (100.64–100.127) continua bloqueada', async () => {
    for (const ip of ['100.64.0.1', '100.100.50.2', '100.127.255.254']) {
      resolve4.mockResolvedValue([ip])
      const r = await validateWebhookUrlAsync(`https://${host()}/hook`)
      expect(r.safe, `${ip} é CGNAT e deveria reprovar`).toBe(false)
    }
  })

  it('DNS que não resolve é recusado (fail-closed)', async () => {
    resolve4.mockResolvedValue([])
    expect((await validateWebhookUrlAsync(`https://${host()}/hook`)).safe).toBe(false)
  })
})
