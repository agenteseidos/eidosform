#!/usr/bin/env node
/**
 * Backfill dos anexos: URL pública gravada na resposta → ficha em `form_files` + URL nossa.
 *
 * SEGURO POR CONSTRUÇÃO:
 *  · `--dry` (padrão) não escreve nada;
 *  · só toca em anexo cuja URL bate com o prefixo público canônico;
 *  · CONFERE que o caminho pertence ao formulário da resposta antes de migrar — um anexo que já
 *    esteja cruzado (o replay entre formulários que existia) é REPORTADO, nunca migrado às cegas.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const env = (k) => {
  const t = readFileSync('.env.production.local', 'utf8')
  const m = t.match(new RegExp(`^${k}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}
const SUPA = env('NEXT_PUBLIC_SUPABASE_URL')
const db = createClient(SUPA, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const SEGREDO = env('FILE_LINK_SECRET') || process.env.FILE_LINK_SECRET || ''
const APP = env('NEXT_PUBLIC_APP_URL') || 'https://eidosform.com.br'
const PREFIXO = `${SUPA}/storage/v1/object/public/form-uploads/`
const ESCREVER = process.argv.includes('--apply')

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
const urlNossa = (fileId, versao) => {
  if (!SEGREDO) return null
  const corpo = b64url(`v1.${fileId}.${versao}`)
  return `${APP}/arquivo/${corpo}.${createHmac('sha256', SEGREDO).update(corpo).digest('base64url')}`
}

const ehAnexoLegado = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) &&
  typeof v.name === 'string' && typeof v.url === 'string' && v.url.startsWith(PREFIXO) && !v.file_id

const { data: respostas, error } = await db
  .from('responses').select('id, form_id, answers').limit(5000)
if (error) { console.error('erro ao ler respostas:', error.message); process.exit(1) }

const versoes = new Map()
let anexos = 0, migrados = 0, cruzados = 0, semForm = 0
for (const r of respostas ?? []) {
  const answers = r.answers || {}
  const alvos = Object.entries(answers).filter(([, v]) => ehAnexoLegado(v))
  if (!alvos.length) continue

  if (!versoes.has(r.form_id)) {
    const { data: f } = await db.from('forms').select('file_access_version').eq('id', r.form_id).maybeSingle()
    if (!f) { semForm += alvos.length; continue }
    versoes.set(r.form_id, f.file_access_version ?? 1)
  }
  const versao = versoes.get(r.form_id)

  const novas = { ...answers }
  let mudou = false
  for (const [qid, v] of alvos) {
    anexos++
    const caminho = v.url.slice(PREFIXO.length)
    // O caminho do respondente é `{user_id}/{form_id}/{uuid}.{ext}` — confere o formulário.
    const partes = caminho.split('/')
    const formNoCaminho = partes.length >= 3 && partes[0] !== 'assets' ? partes[1] : null
    if (formNoCaminho && formNoCaminho !== r.form_id) {
      cruzados++
      console.log(`  ⚠️ CRUZADO — resposta ${r.id} (form ${r.form_id}) aponta p/ arquivo do form ${formNoCaminho}`)
      continue
    }

    if (!ESCREVER) { migrados++; continue }
    const { data: ficha, error: e1 } = await db.from('form_files').insert({
      form_id: r.form_id, question_id: qid, response_id: r.id, object_path: caminho,
      original_name: v.name, declared_mime: v.type ?? null, size_bytes: v.size ?? null,
      status: 'claimed', claimed_at: new Date().toISOString(),
    }).select('id').single()
    if (e1) { console.log(`  erro na ficha (${caminho}): ${e1.message}`); continue }
    novas[qid] = { name: v.name, type: v.type, size: v.size, file_id: ficha.id, url: urlNossa(ficha.id, versao) }
    mudou = true; migrados++
  }
  if (mudou && ESCREVER) {
    const { error: e2 } = await db.from('responses').update({ answers: novas }).eq('id', r.id)
    if (e2) console.log(`  erro ao atualizar resposta ${r.id}: ${e2.message}`)
  }
}

console.log(`\n${ESCREVER ? 'APLICADO' : 'SIMULAÇÃO (use --apply para gravar)'}`)
console.log(`  anexos legados encontrados: ${anexos}`)
console.log(`  migrados:                   ${migrados}`)
console.log(`  CRUZADOS (não migrados):    ${cruzados}`)
console.log(`  sem formulário:             ${semForm}`)
