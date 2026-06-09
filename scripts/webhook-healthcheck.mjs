#!/usr/bin/env node
/**
 * webhook-healthcheck.mjs — prova que o webhook do Asaas ENTREGA + AUTENTICA, ANTES de dinheiro real.
 *
 * HARDENING (2026-06-09): teria pego os 3 bugs do incidente de produção:
 *   1. URL com redirect (.vercel.app → eidosform.com.br dava 302; o Asaas não segue POST)
 *   2. hasAuthToken=false na config do webhook
 *   3. secret com \n / divergente entre Asaas e o app
 *
 * Checa (contra a URL que está REALMENTE configurada no Asaas):
 *   - GET /webhooks: a config existe, enabled=true, interrupted=false, hasAuthToken=true
 *   - POST na URL configurada NÃO redireciona (status != 3xx)
 *   - POST sem token → 401 (handler vivo, rejeita)
 *   - POST com o ASAAS_WEBHOOK_SECRET (trim) → 200 (auth do app casa com o secret)
 *
 * Uso:
 *   ENV_FILE=.env.production.local node scripts/webhook-healthcheck.mjs
 *
 * SAÍDA: ✅ PASS (libera) ou 🔴 FAIL (NÃO cobre dinheiro real até resolver).
 */
import { readFileSync } from 'fs'
function loadEnv(path) {
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('='); if (eq < 0) continue
      const key = line.slice(0, eq).trim(); let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch { /* opcional */ }
}
loadEnv(process.env.ENV_FILE || '.env.production.local')

const ASAAS_KEY = process.env.ASAAS_API_KEY || process.env.ASAAS_SANDBOX_API_KEY
const ASAAS_ENV = (process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase()
const BASE = ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
// o app faz .trim() no secret. O `vercel env pull` escapa newline real como `\n` literal no arquivo
// → removemos `\n`/`\r`/`\t` literais antes do trim p/ casar com o valor efetivo do app.
const SECRET = (process.env.ASAAS_WEBHOOK_SECRET || process.env.ASAAS_WEBHOOK_TOKEN || '').replace(/\\[nrt]/g, '').trim()

if (!ASAAS_KEY) { console.error('falta ASAAS_API_KEY'); process.exit(1) }

const checks = []
const add = (ok, label, detail = '') => { checks.push({ ok, label, detail }); console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? '  — ' + detail : ''}`) }

console.log(`\n${'═'.repeat(70)}\n  WEBHOOK HEALTHCHECK · env=${ASAAS_ENV.toUpperCase()}\n${'═'.repeat(70)}`)

// 1) config do webhook no Asaas
const wh = await (await fetch(`${BASE}/webhooks`, { headers: { access_token: ASAAS_KEY } })).json()
const cfg = (wh.data || [])[0]
if (!cfg) { add(false, 'Webhook configurado no Asaas', 'NENHUM webhook encontrado'); finish() }
add(!!cfg.url, 'Webhook existe', cfg?.url)
add(cfg.enabled === true, 'enabled = true', `enabled=${cfg.enabled}`)
add(cfg.interrupted === false, 'interrupted = false (fila não penalizada)', `interrupted=${cfg.interrupted}`)
add(cfg.hasAuthToken === true, 'hasAuthToken = true (token de auth salvo)', `hasAuthToken=${cfg.hasAuthToken}`)

const url = cfg.url
// URL final = domínio CANÔNICO, não .vercel.app (que redireciona → foi o bug do incidente).
add(!/vercel\.app/i.test(url || ''), 'URL é domínio canônico (não .vercel.app)', url)

// Ambiente de produção + chave de produção.
add(ASAAS_ENV === 'production', 'ASAAS_ENVIRONMENT = production', ASAAS_ENV)
add(/^\$aact_prod_/.test(ASAAS_KEY || ''), 'ASAAS_API_KEY é de produção ($aact_prod_)', (ASAAS_KEY || '').slice(0, 12) + '…')

// Header de PROBE: o handler reconhece e NÃO dispara o alerta de 401 nos testes abaixo (anti
// falso-alarme). Evento WEBHOOK_HEALTHCHECK não está no switch → handler ignora (sem efeito colateral).
const PROBE = { 'Content-Type': 'application/json', 'x-healthcheck-probe': '1' }
const body = JSON.stringify({ event: 'WEBHOOK_HEALTHCHECK', payment: { id: 'healthcheck', customer: 'healthcheck', value: 1, status: 'CONFIRMED' } })

// 2) a URL NÃO redireciona (POST direto, sem seguir redirect)
const rNoFollow = await fetch(url, { method: 'POST', redirect: 'manual', headers: PROBE, body })
const is3xx = rNoFollow.status >= 300 && rNoFollow.status < 400
add(!is3xx, 'URL não redireciona (sem 3xx)', `HTTP ${rNoFollow.status}${is3xx ? ' → ' + (rNoFollow.headers.get('location') || '?') : ''}`)

// 3) sem token → 401 (handler vivo)
const rNoTok = await fetch(url, { method: 'POST', headers: PROBE, body })
add(rNoTok.status === 401, 'Sem token → 401 (handler ativo, rejeita)', `HTTP ${rNoTok.status}`)

// 4) token ERRADO → 401 (não aceita qualquer coisa)
const rBadTok = await fetch(url, { method: 'POST', headers: { ...PROBE, 'asaas-access-token': 'token-errado-de-proposito' }, body })
add(rBadTok.status === 401, 'Token errado → 401 (rejeita)', `HTTP ${rBadTok.status}`)

// 5) com o secret do app → 200 (auth casa)
if (SECRET) {
  const rTok = await fetch(url, { method: 'POST', headers: { ...PROBE, 'asaas-access-token': SECRET }, body })
  add(rTok.status === 200, 'Com ASAAS_WEBHOOK_SECRET → 200 (auth do app casa)', `HTTP ${rTok.status}`)
} else {
  add(false, 'ASAAS_WEBHOOK_SECRET presente no ambiente', 'AUSENTE — não dá p/ validar auth')
}

finish()

function finish() {
  const allPass = checks.every((c) => c.ok)
  console.log(`  ${'─'.repeat(66)}`)
  console.log(`  ${allPass ? '✅ PASS — webhook entrega e autentica. Liberado p/ cobrança real.' : '🔴 FAIL — NÃO cobre dinheiro real até resolver os 🔴 acima.'}`)
  process.exit(allPass ? 0 : 1)
}
