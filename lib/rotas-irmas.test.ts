/**
 * Guarda de CONSISTÊNCIA entre rotas irmãs (auditoria 2026-08, lote 2-bis).
 *
 * As 12 divergências D1–D12 não foram 12 bugs independentes: foram 12 sintomas do MESMO hábito
 * — corrigir uma rota e esquecer a gêmea. Só no lote 2 esse padrão explicou 4 dos 6 achados.
 *
 * Corrigir os 11 sem travar a regra deixa o hábito intacto: em três meses a próxima rota nasce
 * divergente de novo. Estes testes leem o CÓDIGO-FONTE e falham quando uma família volta a
 * divergir — é a única camada que pega isso, porque teste de rota só enxerga a rota que testa.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(__dirname, '..')
const ler = (p: string) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '')

describe('consistência entre rotas irmãs', () => {
  it('D10: nenhuma rota compara segredo com === ou !== (todas usam o helper)', () => {
    const rotas = [
      'app/api/cron/abandoned-leads/route.ts',
      'app/api/cron/abandoned-leads-email/route.ts',
      'app/api/cron/expire-plans/route.ts',
      'app/api/cron/reconcile-checkouts/route.ts',
      'app/api/cron/reconcile-subscriptions/route.ts',
      'app/api/cron/sweep-received/route.ts',
      'app/api/plano/lookup/route.ts',
      'app/api/migracao/recommend/route.ts',
      'app/api/whatsapp/send/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      // Comparação direta de segredo — o padrão que vazava o segredo por tempo de resposta.
      expect(src, `${r} compara segredo com ===/!==`).not.toMatch(
        /(!==|===)\s*`Bearer \$\{|token\s*(===|!==)\s*process\.env/
      )
      expect(src, `${r} deveria usar isValidBearerSecret`).toContain('isValidBearerSecret')
    }
  })

  it('D2/D3: toda rota que grava resposta ou assina upload bloqueia form fechado/pausado', () => {
    const rotas = [
      'app/api/responses/route.ts',
      'app/api/responses/partial/route.ts',
      'app/api/forms/[id]/partial-response/route.ts',
      'app/api/upload/sign-url/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      expect(src, `${r} não checa paused`).toMatch(/\.paused/)
    }
  })

  it('D4: toda rota que grava owner_phone usa a regra única de lib/phone', () => {
    const rotas = [
      'app/api/forms/[id]/whatsapp/route.ts',
      'app/api/whatsapp/settings/route.ts',
      'app/api/whatsapp/settings/[formId]/route.ts',
      'app/api/form/[id]/whatsapp/settings/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      expect(src, `${r} não valida com isValidWhatsAppPhone`).toContain('isValidWhatsAppPhone')
      // Gravar `.trim()` cru era o defeito: entrava máscara, `+` e espaços no banco.
      expect(src, `${r} grava owner_phone cru`).not.toMatch(/owner_phone(:|\s*=)\s*[\w.]*owner_phone\.trim\(\)/)
    }
  })

  it('D5: as duas rotas de export de CSV dividem o mesmo balde apertado', () => {
    const a = ler('app/api/forms/[id]/export-csv/route.ts')
    const b = ler('app/api/forms/[id]/export/route.ts')
    expect(a).toContain('csv-export:')
    expect(b, '/export usa balde próprio — o teto de 5/h vira decorativo').toContain('csv-export:')
    // `[\s\S]` no lugar da flag `s` — o tsconfig do projeto mira ES2017.
    expect(b, '/export deveria usar janela de hora, não de minuto').not.toMatch(
      /csv-export[\s\S]*?windowMs:\s*60_?000\b/
    )
  })

  it('D7: toda rota de auth tem rate limit', () => {
    const rotas = [
      'app/api/auth/login/route.ts',
      'app/api/auth/signup/route.ts',
      'app/api/auth/forgot-password/route.ts',
      'app/api/auth/resend-verification/route.ts',
      'app/api/auth/reset-password/route.ts',
      'app/api/auth/change-password/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      expect(src, `${r} SEM rate limit`).toMatch(/checkRateLimit(Async)?\(/)
    }
  })

  it('D9: rotas com efeito externo (e-mail/WhatsApp/gateway) têm rate limit', () => {
    const rotas = [
      'app/api/settings/billing-profile/route.ts',
      'app/api/settings/api-key/route.ts',
      'app/api/domains/route.ts',
      'app/api/form/[id]/whatsapp/test/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      expect(src, `${r} dispara efeito externo SEM teto`).toMatch(/checkRateLimit(Async)?\(/)
    }
  })

  it('D11: telefone nunca vira chave de rate limit em claro', () => {
    const rotas = [
      'app/api/migracao/recommend/route.ts',
      'app/api/internal/conversion/check/route.ts',
      'app/api/internal/account-context/route.ts',
    ]
    for (const r of rotas) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      // `migracao:${phone}` — telefone canônico legível virando linha persistida.
      expect(src, `${r} usa telefone cru como chave`).not.toMatch(
        /checkRateLimitAsync\(\s*`[^`]*\$\{phone\}/
      )
    }
  })

  it('L5: nenhuma rota consulta created_at/updated_at em `responses` — as colunas NÃO EXISTEM', () => {
    // A listagem da API v1 pedia `created_at, updated_at` de `responses` e devolvia 500 em 100%
    // das chamadas — o PostgREST recusa a consulta inteira quando uma coluna do `select` não
    // existe. As colunas reais são `submitted_at` e `last_activity_at`; confirmado no CATÁLOGO do
    // banco em 07/08/2026, não nos arquivos .sql (Regra Nº 1 do CLAUDE.md).
    //
    // Esta varredura vale mais que a correção: o erro é invisível em revisão de código (o nome
    // parece óbvio demais para estar errado) e só aparece quando um cliente chama a API.
    const rotas: string[] = []
    const varrer = (dir: string) => {
      for (const nome of readdirSync(join(raiz, dir), { withFileTypes: true })) {
        const rel = `${dir}/${nome.name}`
        if (nome.isDirectory()) varrer(rel)
        else if (nome.name === 'route.ts') rotas.push(rel)
      }
    }
    varrer('app/api')
    expect(rotas.length, 'nenhuma rota encontrada — a varredura quebrou').toBeGreaterThan(20)

    for (const r of rotas) {
      const src = ler(r)
      // Só interessa o trecho que consulta `responses`.
      if (!/\.from\(\s*['"]responses['"]\s*\)/.test(src)) continue
      for (const bloco of src.split(/\.from\(\s*['"]responses['"]\s*\)/).slice(1)) {
        // ESCOPO da consulta = só a cadeia encadeada logo depois do `.from('responses')`.
        // Recortar até o próximo `.from(` era demais: em `admin/forms/route.ts` a cadeia termina
        // e o código seguinte fala de `forms`, que TEM `created_at` — dava falso positivo. A
        // cadeia acaba na primeira linha em branco ou na primeira que não começa por `.`.
        const linhas: string[] = []
        for (const linha of bloco.split('\n')) {
          if (linhas.length > 0 && !/^\s*\./.test(linha)) break
          linhas.push(linha)
        }
        const consulta = linhas.join('\n')
        expect(consulta, `${r}: consulta \`responses\` usando created_at/updated_at, que não existem`)
          .not.toMatch(/['"][^'"]*\b(created_at|updated_at)\b/)
      }
    }
  })

  it('D12: as duas rotas de escrita de formulário cortam payload antes do Zod', () => {
    for (const r of ['app/api/forms/route.ts', 'app/api/forms/[id]/route.ts']) {
      const src = ler(r)
      expect(src, `${r} não encontrada`).not.toBe('')
      expect(src, `${r} sem teto de payload`).toMatch(/500 \* 1024/)
    }
  })
})
