import { NextResponse } from 'next/server'

/**
 * GET /api/health — endpoint INÓCUO de saúde e versão.
 *
 * Serve também para responder "o deploy já subiu?" SEM efeito colateral.
 *
 * Contexto (2026-07-23): para descobrir quando um deploy tinha propagado, o
 * endpoint `/api/cron/abandoned-leads` foi chamado em laço. Aquele endpoint não
 * RESPONDE uma pergunta — ele EXECUTA a rotina de alertas, então cada "checagem"
 * rodava o cron de verdade (e crons concorrentes foram um dos ingredientes do
 * incidente de alertas falsos no mesmo dia). Detectar ≠ observar.
 *
 * Daqui pra frente, detecção de deploy é:
 *     curl -s https://eidosform.com.br/api/health   → compara `commit`
 *
 * `commit` vem de VERCEL_GIT_COMMIT_SHA (injetada no build); local vira 'dev'.
 * Só o SHA curto: identifica a build sem expor nada sensível.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: sha ? sha.slice(0, 7) : 'dev',
    env: process.env.VERCEL_ENV ?? 'local',
  })
}
