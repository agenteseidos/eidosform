import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { lerFileToken } from '@/lib/file-link-token'
import { log, logError, logWarn } from '@/lib/logger'

/**
 * GET /arquivo/[token] — o porteiro dos anexos (16/08/2026).
 *
 * ANTES: o arquivo que o respondente enviava ficava numa URL pública do storage — permanente,
 * sem login, sem expiração, sem como revogar e sem como saber que foi aberta. Essa URL era
 * copiada para SEIS lugares (painel, planilha, webhook, e-mail, WhatsApp, export), então bastava
 * uma planilha compartilhada com a pessoa errada para entregar o documento de um lead.
 *
 * AGORA: o link é nosso e cada acesso RESOLVE O ESTADO ATUAL — nunca confia no que veio dentro
 * do token. A ordem importa e é o contrato desta rota:
 *
 *   token válido? → a ficha do arquivo → o formulário → o dono ATUAL → o modo ATUAL → revogado?
 *
 * Foi a correção central do parecer independente. Autorizar pelo dono embutido no caminho (o que
 * eu tinha proposto) quebraria numa transferência de formulário, e um HMAC do caminho não
 * permitiria revogar nem expirar nada.
 *
 * ⚠️ NUNCA responder de forma que diferencie "não existe" de "existe e você não pode": as duas
 * viram 404. Um 403 informativo confirmaria a existência do arquivo para quem tem o link vazado.
 */

/** Segundos de validade da URL assinada. Curto de propósito: é só a travessia do redirect. */
const VALIDADE_S = 60

/**
 * Tipos que o painel pode DESENHAR na tela (`?preview=1`) em vez de baixar.
 *
 * Por que uma lista fechada: o anexo é conteúdo de terceiro. Um HTML ou um SVG renderizado
 * carrega script junto — e SVG é imagem para o navegador, então entraria numa regra genérica
 * de "imagem pode". Fora desta lista, tudo continua baixando.
 *
 * O que limita o estrago mesmo assim: o redirect leva ao domínio do STORAGE, não ao nosso, e o
 * `iframe` do painel tem `sandbox=""` — script não roda nem com a nossa origem, nem com a dele.
 */
const PODE_DESENHAR = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
])

function nao(): NextResponse {
  // 404 mudo, com cabeçalhos que impedem qualquer camada de guardar a resposta.
  return new NextResponse('Arquivo não encontrado', {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const lido = lerFileToken(token)
  if (!lido.ok) {
    // Token forjado/alterado nem chega ao banco. Log sem o token: registrar o crachá inteiro no
    // log daria a quem lê o log a mesma chave que o portador tem.
    logWarn('[arquivo] token inválido', { motivo: lido.motivo })
    return nao()
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[arquivo] service-role ausente')
    return nao()
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // ── A FICHA DO ARQUIVO ────────────────────────────────────────────────────────────────────
  const { data: arquivo, error } = await db
    .from('form_files')
    .select('id, form_id, object_path, original_name, declared_mime, status, revoked_at, expires_at')
    .eq('id', lido.fileId)
    .maybeSingle()

  if (error) {
    // Falha de banco NEGA o acesso. Deixar passar "porque não deu para conferir" seria abrir a
    // porta exatamente quando não sabemos quem está do outro lado.
    logError('[arquivo] falha ao ler a ficha do arquivo — negando', error)
    return nao()
  }
  if (!arquivo) return nao()

  const a = arquivo as {
    id: string; form_id: string; object_path: string; original_name: string | null
    declared_mime: string | null; status: string; revoked_at: string | null; expires_at: string | null
  }

  if (a.status === 'deleted' || a.revoked_at) return nao()
  if (a.expires_at && Date.parse(a.expires_at) <= Date.now()) return nao()
  // `pending` = upload assinado mas nunca confirmado. Não é arquivo entregue; não se serve.
  if (a.status !== 'ready' && a.status !== 'claimed') return nao()

  // ── O FORMULÁRIO, LIDO AGORA (dono e modo ATUAIS, não os do momento do link) ──────────────
  const { data: form, error: erroForm } = await db
    .from('forms')
    .select('id, user_id, file_access_mode, file_access_version')
    .eq('id', a.form_id)
    .maybeSingle()

  if (erroForm) {
    logError('[arquivo] falha ao ler o formulário — negando', erroForm)
    return nao()
  }
  if (!form) return nao() // formulário apagado → o link morre junto

  const f = form as { id: string; user_id: string; file_access_mode: string; file_access_version: number }

  // ── A VERSÃO: é isto que mata link já distribuído ─────────────────────────────────────────
  // Trocar o formulário de "qualquer pessoa com o link" para "somente eu" incrementa a versão.
  // Todo link emitido antes para de bater aqui — sem mover arquivo e sem varrer planilha.
  if (lido.versao !== f.file_access_version) {
    log('[arquivo] link de versão antiga — acesso revogado pela troca de política', {
      formId: f.id, versaoDoLink: lido.versao, versaoAtual: f.file_access_version,
    })
    return nao()
  }

  // ── A POLÍTICA ATUAL ──────────────────────────────────────────────────────────────────────
  if (f.file_access_mode !== 'link') {
    // Modo 'owner_only' (padrão): exige sessão E que a sessão seja a do DONO ATUAL do formulário.
    // Não basta ter conta no EidosForm — senão qualquer cliente nosso abriria anexo de qualquer
    // outro. E o dono é lido do formulário agora, então transferência não quebra a autorização.
    let userId: string | null = null
    try {
      const supabase = await createServerClient()
      const { data } = await supabase.auth.getUser()
      userId = data.user?.id ?? null
    } catch (err) {
      logWarn('[arquivo] falha ao resolver sessão — negando', { err: String(err).slice(0, 120) })
      return nao()
    }
    if (!userId || userId !== f.user_id) return nao()
  }

  // ── A TRAVESSIA ───────────────────────────────────────────────────────────────────────────
  // VISUALIZAR × BAIXAR (18/08). O padrão é BAIXAR: anexo é conteúdo de terceiro e forçar
  // download é o que impede um HTML/SVG de ser renderizado. Mas isso deixava o preview do painel
  // como um retângulo branco — o navegador se recusa a desenhar no iframe o que veio marcado
  // como anexo. Com `?preview=1` e um tipo da lista fechada, servimos para exibição.
  const querPreview = new URL(req.url).searchParams.get('preview') === '1'
  const podeExibir = querPreview && PODE_DESENHAR.has(String(a.declared_mime ?? ''))

  const { data: assinada, error: erroAssinatura } = await db.storage
    .from('form-uploads')
    .createSignedUrl(a.object_path, VALIDADE_S,
      podeExibir ? {} : { download: a.original_name ?? true })

  if (erroAssinatura || !assinada?.signedUrl) {
    logError('[arquivo] falha ao assinar a leitura', erroAssinatura, { fileId: a.id })
    return nao()
  }

  log('[arquivo] entregue', { fileId: a.id, formId: f.id, modo: f.file_access_mode, exibindo: podeExibir })

  return NextResponse.redirect(assinada.signedUrl, {
    status: 302,
    headers: {
      // Sem isto, um CDN ou o próprio navegador guardaria o redirect e a revogação demoraria
      // a valer. `no-store` é o que faz cada clique passar de novo pelo porteiro.
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
