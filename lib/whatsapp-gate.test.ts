import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canUseLeadWhatsApp } from './whatsapp-capability'
import { PLANS } from './plan-definitions'

/**
 * Testes de CONTRATO do gate de WhatsApp (decisão Sidney 2026-07-30).
 *
 * Rotas Next não são testáveis de forma barata aqui (precisariam de Supabase e
 * auth reais). Então este arquivo trava as invariantes que a auditoria do Codex
 * apontou como os 3 maiores riscos, por leitura do próprio código-fonte —
 * suficiente para pegar regressão em revisão/CI:
 *   1. bypass no ENVIO (direct-send sem formId; sink/cron decidindo por plano)
 *   2. bypass de CONFIGURAÇÃO (rotas de settings decidindo por plano)
 *   3. regressão do admin (feature acidentalmente amarrada a `isAdminEmail`)
 */

const raiz = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

const ROTAS_QUE_CONFIGURAM = [
  'app/api/whatsapp/settings/route.ts',
  'app/api/whatsapp/settings/[formId]/route.ts',
  'app/api/forms/[id]/whatsapp/route.ts',
  'app/api/form/[id]/whatsapp/settings/route.ts',
  'app/api/form/[id]/whatsapp/test/route.ts',
]
const CAMINHOS_DE_ENVIO = [
  'app/api/whatsapp/send/route.ts',
  'app/api/responses/route.ts',
  'app/api/cron/abandoned-leads/route.ts',
]

describe('gate de WhatsApp — invariantes de contrato', () => {
  it('RISCO 1: nenhum caminho de ENVIO decide por plano', () => {
    for (const rota of CAMINHOS_DE_ENVIO) {
      const src = ler(rota)
      expect(/PLANS\[[^\]]*\]\?\.whatsappNotifications/.test(src), `${rota} ainda decide por plano`).toBe(false)
      expect(/isPlusPlan\(/.test(src), `${rota} ainda usa isPlusPlan`).toBe(false)
      expect(src.includes('canUseLeadWhatsApp'), `${rota} não usa a política única`).toBe(true)
    }
  })

  it('RISCO 1: direct-send SEM formId é recusado (era o bypass mais largo)', () => {
    const src = ler('app/api/whatsapp/send/route.ts')
    expect(src).toMatch(/if \(!data\.formId\)/)
    // A frase do bug antigo não pode voltar
    expect(src).not.toMatch(/no plan gate applied/)
  })

  it('RISCO 1: o cron filtra ANTES do claim (senão vira martelo a cada 15min)', () => {
    const src = ler('app/api/cron/abandoned-leads/route.ts')
    const posFiltro = src.indexOf('canUseLeadWhatsApp')
    const posClaim = src.indexOf('abandoned_alert')
    expect(posFiltro).toBeGreaterThan(-1)
    expect(posFiltro, 'filtro de capacidade precisa vir antes do claim').toBeLessThan(posClaim)
  })

  it('RISCO 2: toda rota que configura WhatsApp usa a política única', () => {
    for (const rota of ROTAS_QUE_CONFIGURAM) {
      const src = ler(rota)
      expect(src.includes('canUseLeadWhatsApp'), `${rota} não usa a política única`).toBe(true)
      expect(/isPlusPlan\(getEffectivePlan/.test(src), `${rota} ainda tem gate por plano`).toBe(false)
    }
  })

  it('RISCO 3: a capacidade NÃO está amarrada a "ser admin"', () => {
    // Se um dia isto falhar, um 2º admin ganharia de brinde uma feature que já
    // levou a linha a uma restrição de 6h. São capacidades diferentes.
    const politica = ler('lib/whatsapp-capability.ts')
    // Tira comentários antes de checar: o arquivo MENCIONA `isAdminEmail` na
    // documentação, justamente para explicar por que NÃO o usa. O que importa
    // é o código executável.
    const codigo = politica
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    expect(codigo).not.toMatch(/isAdminEmail|ADMIN_EMAILS|requireAdmin|admin-auth/)
    expect(codigo).toMatch(/WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS/)
  })

  it('o PUT de forms IGNORA os campos legados sem rejeitar (autosave não pode quebrar)', () => {
    const src = ler('app/api/forms/[id]/route.ts')
    // Precisa ser condicional na capacidade…
    expect(src).toMatch(/canUseLeadWhatsApp\([^)]*\) && notify_whatsapp_enabled !== undefined/)
    // …e NUNCA devolver erro por causa desses campos.
    expect(src).not.toMatch(/notify_whatsapp[^\n]*status: 4\d\d/)
  })

  it('nenhum plano comercial declara a feature', () => {
    for (const [id, cfg] of Object.entries(PLANS)) {
      expect(cfg.whatsappNotifications, `plano ${id} ainda declara whatsappNotifications`).toBe(false)
    }
  })
})

describe('gate de WhatsApp — comportamento fail-closed', () => {
  const original = process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
    else process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = original
  })

  it('sem env, nem o dono dos 8 formulários de produção passa', () => {
    delete process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
    expect(canUseLeadWhatsApp('02a8c2a5-dc7e-4243-8a3a-2e56223df0c2')).toBe(false)
  })
})
