/**
 * Guarda de APOSENTADORIA dos schemas .sql e do README (remediação 1C.4).
 *
 * O lote 1 removeu do banco de produção a policy "Anyone can view published forms", que deixava
 * qualquer visitante — sem login — ler a linha inteira de um formulário publicado de qualquer
 * cliente (webhook_url, notify_email, telefone de notificação, google_sheets_id) e, somada aos
 * GRANTs amplos ao papel anon, abria caminho para alterá-lo e apagá-lo.
 *
 * Só que o buraco continuava documentado: o README mandava executar
 * `supabase/schema_eidosform.sql`, e os dois .sql ainda criavam a policy. Quem seguisse o README
 * numa instalação nova REABRIA exatamente o que o lote 1 fechou — e o dono do formulário perderia
 * os leads dele para quem tivesse o link.
 *
 * A correção não foi "arrumar o SQL para bater com produção" (a REGRA Nº 1 do CLAUDE.md proíbe:
 * o repositório não descreve o banco), e sim APOSENTAR os arquivos: aviso no topo + uma trava
 * `RAISE EXCEPTION` que aborta a execução antes de qualquer DDL. Estes testes leem os arquivos e
 * quebram se o aviso, a trava, ou a instrução do README voltarem a ficar perigosos.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

/** Os dois retratos históricos aposentados pela remediação 1C.4. */
const SCHEMAS_APOSENTADOS = ['supabase/schema.sql', 'supabase/schema_eidosform.sql']

/** A permissão que o lote 1 derrubou do banco. Buscada como CREATE para não pegar o DROP da migration. */
const CRIA_POLICY_PERIGOSA = /CREATE\s+POLICY\s+"Anyone can view published forms"/i

/** Carimbo inequívoco no topo do arquivo. Sem ele, ninguém sabe que o arquivo é veneno. */
const CARIMBO = /⛔\s*ARQUIVO APOSENTADO/

/** Trava executável: bloco DO que dispara RAISE EXCEPTION. */
const TRAVA = /DO\s+\$\$[\s\S]{0,600}?RAISE\s+EXCEPTION[\s\S]{0,600}?END\s+\$\$\s*;/i

/** Lista recursiva de todos os .sql sob supabase/. */
function todosOsSql(dir: string): string[] {
  const achados: string[] = []
  for (const item of readdirSync(join(raiz, dir), { withFileTypes: true })) {
    const rel = `${dir}/${item.name}`
    if (item.isDirectory()) achados.push(...todosOsSql(rel))
    else if (item.name.endsWith('.sql')) achados.push(rel)
  }
  return achados
}

describe('schemas .sql aposentados', () => {
  it.each(SCHEMAS_APOSENTADOS)('%s carrega o carimbo de aposentadoria no cabeçalho', (arquivo) => {
    const cabecalho = ler(arquivo).split('\n').slice(0, 15).join('\n')
    expect(cabecalho, `${arquivo} perdeu o aviso "⛔ ARQUIVO APOSENTADO" do topo`).toMatch(CARIMBO)
  })

  it.each(SCHEMAS_APOSENTADOS)('%s avisa que diverge do banco e aponta a Regra Nº 1', (arquivo) => {
    const src = ler(arquivo)
    expect(src, `${arquivo} não avisa que diverge do banco real`).toMatch(/DIVERGE/i)
    expect(src, `${arquivo} não aponta a REGRA Nº 1 do CLAUDE.md`).toMatch(/REGRA Nº 1/)
    expect(src, `${arquivo} não aponta o CLAUDE.md`).toContain('CLAUDE.md')
  })

  it.each(SCHEMAS_APOSENTADOS)('%s aborta a execução antes de qualquer DDL', (arquivo) => {
    const src = ler(arquivo)
    const trava = src.search(TRAVA)
    expect(trava, `${arquivo} não tem a trava DO $$ ... RAISE EXCEPTION ... END $$`).toBeGreaterThan(-1)

    // A trava só protege se vier ANTES do primeiro comando que cria coisa no banco.
    const primeiroDdl = src.search(/^\s*(CREATE|ALTER|GRANT|INSERT)\b/im)
    expect(primeiroDdl, `${arquivo} não tem DDL — revise este teste`).toBeGreaterThan(-1)
    expect(
      trava,
      `${arquivo}: a trava RAISE EXCEPTION está DEPOIS do primeiro DDL, então não impede nada`
    ).toBeLessThan(primeiroDdl)
  })

  it('todo .sql que recria a policy anônima está aposentado e travado', () => {
    const suspeitos = todosOsSql('supabase').filter((f) => CRIA_POLICY_PERIGOSA.test(ler(f)))

    // Os dois conhecidos ainda têm a policy (preservada de propósito como registro histórico).
    // Se um .sql NOVO passar a criá-la, ele cai aqui e precisa do mesmo tratamento.
    expect(suspeitos.length, 'nenhum arquivo com a policy — revise este teste').toBeGreaterThan(0)

    for (const arquivo of suspeitos) {
      const src = ler(arquivo)
      expect(
        src.split('\n').slice(0, 15).join('\n'),
        `${arquivo} cria "Anyone can view published forms" sem o carimbo de aposentadoria`
      ).toMatch(CARIMBO)
      expect(
        src,
        `${arquivo} cria "Anyone can view published forms" sem trava RAISE EXCEPTION`
      ).toMatch(TRAVA)
    }
  })

  it('a migration do lote 1 que derrubou a policy continua no repositório', () => {
    const migration = 'supabase/migrations/20260729_02_close_legacy_anon_rls.sql'
    expect(existsSync(join(raiz, migration)), `${migration} sumiu — os avisos apontam para ela`).toBe(true)
    expect(ler(migration)).toMatch(/DROP POLICY IF EXISTS "Anyone can view published forms"/)
  })
})

describe('README não instrui a instalação pelos schemas aposentados', () => {
  it('nenhum bloco de comando cita os schemas aposentados', () => {
    const blocos = ler('README.md').match(/```[\s\S]*?```/g) ?? []
    for (const bloco of blocos) {
      for (const arquivo of SCHEMAS_APOSENTADOS) {
        expect(
          bloco.includes(arquivo),
          `README voltou a mandar executar ${arquivo} — isso reabre a leitura anônima dos formulários`
        ).toBe(false)
      }
    }
  })

  it('toda menção aos schemas no README nega a execução', () => {
    const nega = /aposentad|n[ãa]o\s+(execute|executar|rode|rodar|devem?|deve)/i
    const linhas = ler('README.md')
      .split('\n')
      .filter((l) => SCHEMAS_APOSENTADOS.some((a) => l.includes(a)))

    expect(linhas.length, 'README não menciona mais os schemas — o aviso sumiu junto?').toBeGreaterThan(0)
    for (const linha of linhas) {
      expect(nega.test(linha), `README cita um schema aposentado sem desaconselhar: ${linha.trim()}`).toBe(true)
    }
  })

  it('README aponta a Regra Nº 1 e explica o risco', () => {
    const readme = ler('README.md')
    expect(readme, 'README não carrega o carimbo ARQUIVOS APOSENTADOS').toMatch(/ARQUIVOS? APOSENTADOS?/i)
    expect(readme, 'README não aponta a REGRA Nº 1').toMatch(/REGRA Nº 1/)
    expect(readme, 'README não aponta o CLAUDE.md').toContain('CLAUDE.md')
    expect(readme, 'README não nomeia a policy perigosa').toContain('Anyone can view published forms')
  })
})
