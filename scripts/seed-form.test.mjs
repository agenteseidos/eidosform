// Teste do portão destrutivo do seed-form: o `--replace` APAGA um formulário existente, e a
// única coisa que segura o delete é a contagem de respostas. Se essa contagem falhar e o script
// tratar "não sei" como "está vazio", ele destrói respostas de leads — dado que não tem backup.
//
// Por isso o teste roda o script DE VERDADE, em processo separado, com o @supabase/supabase-js
// trocado por um dublê via hook de resolução do Node. Assim o que está sob teste é o arquivo real
// (top-level await, process.exit e tudo), não uma cópia da lógica.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'seed-form.mjs')

let dir

// Dublê do supabase-js: cadeia encadeável (.select().eq()...) que também é "thenable", igual ao
// cliente real, e que grava num arquivo de log toda escrita (delete/insert) que o script pedir.
// É o log que prova se o script chegou ou não a mandar o apagamento.
const STUB = `
import { appendFileSync } from 'node:fs'

const LOG = process.env.SEED_TEST_LOG
const MODE = process.env.SEED_TEST_MODE

function registra(evento) {
  appendFileSync(LOG, JSON.stringify(evento) + '\\n')
}

class Query {
  constructor(tabela) {
    this.tabela = tabela
    this.op = 'select'
  }
  select(_cols, opts) {
    if (opts && opts.head === true) this.contagem = true
    return this
  }
  insert(row) { this.op = 'insert'; this.row = row; return this }
  delete() { this.op = 'delete'; return this }
  eq() { return this }
  single() { return this._executa() }
  maybeSingle() { return this._executa() }
  then(ok, falha) { return this._executa().then(ok, falha) }

  async _executa() {
    if (this.op === 'delete') {
      registra({ op: 'delete', tabela: this.tabela })
      return { data: null, error: null }
    }
    if (this.op === 'insert') {
      registra({ op: 'insert', tabela: this.tabela })
      return { data: { id: 'form-novo', slug: this.row.slug, status: this.row.status }, error: null }
    }
    if (this.tabela === 'profiles') {
      return { data: { id: 'dono-1', email: 'dono@exemplo.test', plan: 'pro' }, error: null }
    }
    if (this.tabela === 'forms') {
      // sempre existe um form com esse slug -> força o caminho do --replace
      return { data: { id: 'form-existente-1', status: 'published' }, error: null }
    }
    if (this.tabela === 'responses' && this.contagem) {
      registra({ op: 'count', tabela: this.tabela })
      if (MODE === 'erro') {
        // falha transitória do banco: o count vem NULO junto com o erro
        return { data: null, count: null, error: { message: 'fetch failed (timeout)' } }
      }
      if (MODE === 'nulo') {
        // resposta sem cabeçalho de contagem: nenhum erro, mas também nenhum número
        return { data: null, count: null, error: null }
      }
      if (MODE === 'tres') return { data: null, count: 3, error: null }
      return { data: null, count: 0, error: null }
    }
    return { data: null, error: null }
  }
}

export function createClient() {
  return { from: (tabela) => new Query(tabela) }
}
`

const HOOKS = `
let stubUrl
export async function initialize(data) { stubUrl = data.stubUrl }
export async function resolve(specifier, context, next) {
  if (specifier === '@supabase/supabase-js') return { url: stubUrl, format: 'module', shortCircuit: true }
  return next(specifier, context)
}
`

const REGISTER = `
import { register } from 'node:module'
register('./hooks.mjs', import.meta.url, {
  data: { stubUrl: new URL('./stub-supabase.mjs', import.meta.url).href },
})
`

const SPEC = {
  ownerEmail: 'dono@exemplo.test',
  slug: 'form-de-teste',
  title: 'Form de Teste',
  questions: [{ type: 'short_text', title: 'Seu nome', required: true }],
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'seed-form-'))
  writeFileSync(path.join(dir, 'stub-supabase.mjs'), STUB)
  writeFileSync(path.join(dir, 'hooks.mjs'), HOOKS)
  writeFileSync(path.join(dir, 'register.mjs'), REGISTER)
  writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(SPEC))
  // credenciais FALSAS de propósito — o dublê nunca abre conexão nenhuma
  writeFileSync(
    path.join(dir, 'env'),
    'NEXT_PUBLIC_SUPABASE_URL=https://stub.supabase.test\nSUPABASE_SERVICE_ROLE_KEY=chave-falsa-de-teste\n'
  )
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function rodaReplace(modo) {
  const logPath = path.join(dir, `chamadas-${modo}.log`)
  const r = spawnSync(
    process.execPath,
    ['--import', path.join(dir, 'register.mjs'), SCRIPT, path.join(dir, 'spec.json'), '--replace'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENV_FILE: path.join(dir, 'env'),
        SEED_TEST_LOG: logPath,
        SEED_TEST_MODE: modo,
      },
    }
  )
  const chamadas = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
  return { ...r, chamadas, saida: `${r.stdout}${r.stderr}` }
}

describe('seed-form --replace: portão antes de apagar formulário', () => {
  it('erro na contagem de respostas ABORTA sem apagar nada', () => {
    const r = rodaReplace('erro')

    expect(r.chamadas.some((c) => c.op === 'delete')).toBe(false)
    expect(r.status).toBe(1)
    expect(r.saida).toMatch(/NÃO consegui contar as respostas/)
    expect(r.saida).toMatch(/fetch failed \(timeout\)/)
  })

  it('contagem nula (sem erro explícito) ABORTA sem apagar nada', () => {
    const r = rodaReplace('nulo')

    expect(r.chamadas.some((c) => c.op === 'delete')).toBe(false)
    expect(r.status).toBe(1)
    expect(r.saida).toMatch(/NÃO consegui contar as respostas/)
  })

  it('formulário com respostas continua protegido', () => {
    const r = rodaReplace('tres')

    expect(r.chamadas.some((c) => c.op === 'delete')).toBe(false)
    expect(r.status).toBe(1)
    expect(r.saida).toMatch(/tem 3 resposta\(s\)/)
  })

  it('contagem confirmada em zero ainda substitui o formulário (o --replace não foi quebrado)', () => {
    const r = rodaReplace('zero')

    expect(r.status).toBe(0)
    expect(r.chamadas.some((c) => c.op === 'delete')).toBe(true)
    expect(r.chamadas.some((c) => c.op === 'insert')).toBe(true)
  })
})
