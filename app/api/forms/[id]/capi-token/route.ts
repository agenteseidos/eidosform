import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getEffectivePlan } from '@/lib/plans'
import { PLANS, type PlanName } from '@/lib/plan-definitions'
import { cifrarToken, dicaDoToken, cofreConfigurado } from '@/lib/capi-credential'
import { validarCredencialCapi } from '@/lib/meta-capi'
import { lerPixelDoFormulario } from '@/lib/pixel-events'
import { log, logError } from '@/lib/logger'

/**
 * /api/forms/[id]/capi-token — o token da API de Conversões, POR FORMULÁRIO.
 *
 * POR QUE UMA ROTA SÓ PARA ISTO, fora do autosave do construtor (18/08/2026):
 *
 * O construtor salva o formulário inteiro num PATCH e o servidor DEVOLVE as colunas gravadas —
 * é assim que ele mantém a tela em sincronia. Se o token entrasse nesse pacote, ele voltaria ao
 * navegador a cada save, ficaria no estado do React e no histórico de rede. Credencial não faz
 * viagem de volta: entra uma vez, e o que retorna é só a DICA ("••••ab12").
 *
 * Por isso também o token não vive em `forms`: mora em `form_capi_credentials`, que só o
 * service-role alcança. Nem o dono logado lê essa tabela pelo navegador — um XSS no painel não
 * colheria os tokens de todos os formulários dele.
 *
 * ORDEM (a mesma dos anexos): autenticar → provar a propriedade → conferir o plano → só então
 * gravar. E 404, nunca 403, para não confirmar a existência de formulário alheio.
 */

type Ctx = { params: Promise<{ id: string }> }

/** Autentica e prova que o formulário é de quem está pedindo. Devolve o pixel configurado nele. */
async function donoDoFormulario(id: string): Promise<
  | { ok: true; userId: string; pixelId: string | null }
  | { ok: false; resposta: NextResponse }
> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) {
    return { ok: false, resposta: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: form, error } = await supabase
    .from('forms')
    .select('id, user_id, pixels')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    logError('[capi-token] falha ao ler o formulário', error, { id })
    return { ok: false, resposta: NextResponse.json({ error: 'Erro ao carregar' }, { status: 500 }) }
  }
  const f = form as { id: string; user_id: string; pixels: Record<string, unknown> | null } | null
  if (!f || f.user_id !== user.id) {
    return { ok: false, resposta: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  // Fonte única (mesma da página pública e do submit): apelidos antigos + formato numérico.
  return { ok: true, userId: user.id, pixelId: lerPixelDoFormulario(f.pixels) }
}

/** O envio pelo servidor é do mesmo plano que os pixels (Plus+). */
async function planoPermite(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .single()
  return Boolean(PLANS[getEffectivePlan(profile) as PlanName]?.pixels)
}

/** GET — a tela pergunta "tem token aqui?". Responde a DICA, nunca o token. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const dono = await donoDoFormulario(id)
  if (!dono.ok) return dono.resposta

  const { data } = await createServiceRoleClient()
    .from('form_capi_credentials')
    .select('hint, pixel_id, validated_at, last_error')
    .eq('form_id', id)
    .maybeSingle()

  const c = data as { hint: string | null; pixel_id: string | null; validated_at: string | null; last_error: string | null } | null
  if (!c) return NextResponse.json({ configurado: false })

  return NextResponse.json({
    configurado: true,
    dica: c.hint,
    validadoEm: c.validated_at,
    // O pixel MUDOU depois de o token ter sido validado? A tela avisa em vez de deixar o envio
    // falhar calado — é o erro de configuração mais provável depois do token errado.
    pixelDivergente: Boolean(c.pixel_id && dono.pixelId && c.pixel_id !== dono.pixelId),
    ultimoErro: c.last_error,
  })
}

/** PUT — guarda o token. Valida contra o Meta ANTES de gravar. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const dono = await donoDoFormulario(id)
  if (!dono.ok) return dono.resposta

  if (!(await planoPermite(dono.userId))) {
    return NextResponse.json(
      { error: 'O envio pelo servidor está disponível a partir do plano Plus.' },
      { status: 403 },
    )
  }

  if (!cofreConfigurado()) {
    // Sem a chave de cifragem NÃO se guarda token em claro como plano B. Falha visível é melhor
    // que uma credencial de terceiro dormindo em texto puro no banco.
    logError('[capi-token] META_CAPI_ENC_KEY ausente — save recusado', null, { formId: id })
    return NextResponse.json(
      { error: 'Configuração do servidor incompleta. Avise o suporte.' },
      { status: 503 },
    )
  }

  let token: string
  let pixelEsperado: string | null = null
  try {
    const body = await req.json()
    token = typeof body?.token === 'string' ? body.token.trim() : ''
    // O que a TELA está mostrando no campo Pixel ID. Não é usado para validar — o servidor usa
    // sempre o do banco — serve só para detectar a corrida abaixo.
    pixelEsperado = typeof body?.pixelEsperado === 'string' ? body.pixelEsperado.trim() : null
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  if (!token) return NextResponse.json({ error: 'Cole o token para salvar.' }, { status: 400 })
  // Teto de sanidade: token do Meta fica bem abaixo disso; acima é colagem errada ou abuso.
  if (token.length > 500) return NextResponse.json({ error: 'Token muito longo.' }, { status: 400 })

  if (!dono.pixelId) {
    return NextResponse.json(
      { error: 'Preencha o Pixel ID antes do token — é ele que diz para qual conta o evento vai.' },
      { status: 400 },
    )
  }

  // CORRIDA COM O AUTOSAVE (achado do parecer independente). O campo do token libera assim que o
  // cliente digita o Pixel, mas o construtor só grava ~1,5s depois. Sem esta checagem, o token
  // seria validado contra o Pixel ANTIGO — aprovado contra a conta errada, ou recusado com o
  // cliente vendo o Pixel certo na tela. Detectar e pedir para esperar é honesto; adivinhar não.
  if (pixelEsperado && pixelEsperado !== dono.pixelId) {
    return NextResponse.json(
      { error: 'O Pixel ID ainda está sendo salvo. Aguarde um instante e tente de novo.', aguarde: true },
      { status: 409 },
    )
  }

  const veredito = await validarCredencialCapi(dono.pixelId, token)

  const cifrado = cifrarToken(token, id)
  if (!cifrado) {
    logError('[capi-token] falha ao cifrar', null, { formId: id })
    return NextResponse.json({ error: 'Não foi possível guardar o token com segurança.' }, { status: 500 })
  }

  // TRÊS DESFECHOS, e cada um merece resposta diferente (correção do parecer independente —
  // a versão anterior tratava tudo como "token inválido" e ainda dizia na tela que tinha salvado):
  //
  //  · recusado  → o Meta respondeu e negou. Não grava; 400 com o motivo.
  //  · temporário→ rede, timeout, 429 ou 5xx. NÃO é culpa do token: não grava, não apaga a
  //                credencial que já existia, e devolve 503 para a tela poder dizer "tente de
  //                novo" em vez de mandar o cliente caçar um token que estava certo.
  //  · ok        → grava.
  if (veredito.estado === 'temporario') {
    return NextResponse.json({ error: veredito.motivo, temporario: true }, { status: 503 })
  }
  if (veredito.estado === 'recusado') {
    // Registra o motivo na credencial EXISTENTE, se houver: assim a tela mostra por que o envio
    // parou, em vez de deixar a coluna `last_error` morta como estava.
    await createServiceRoleClient()
      .from('form_capi_credentials')
      .update({ last_error: veredito.motivo, updated_at: new Date().toISOString() } as never)
      .eq('form_id', id)
    return NextResponse.json({ error: veredito.motivo }, { status: 400 })
  }

  const agora = new Date().toISOString()
  // `validated_at` só é preenchido quando a prova foi CONCLUSIVA (o Meta aceitou o POST no
  // endpoint de eventos). Quando ele reclamou do payload em vez do token, a credencial é aceita
  // — o token passou pela autenticação e pela permissão — mas não temos prova positiva de envio,
  // e a tela diz isso em vez de estampar uma data de validação que não aconteceu.
  const { error } = await createServiceRoleClient()
    .from('form_capi_credentials')
    .upsert({
      form_id: id,
      token_encrypted: cifrado,
      hint: dicaDoToken(token),
      pixel_id: dono.pixelId,
      validated_at: veredito.conclusivo ? agora : null,
      last_error: null,
      updated_at: agora,
    } as never, { onConflict: 'form_id' })

  if (error) {
    logError('[capi-token] falha ao gravar', error, { formId: id })
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }

  log('[capi-token] token gravado e validado', { formId: id, pixelId: dono.pixelId })
  return NextResponse.json({ ok: true, dica: dicaDoToken(token), validadoEm: veredito.conclusivo ? agora : null })
}

/** DELETE — remove o token. O pixel do navegador continua funcionando; só o servidor para. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const dono = await donoDoFormulario(id)
  if (!dono.ok) return dono.resposta

  const { error } = await createServiceRoleClient()
    .from('form_capi_credentials')
    .delete()
    .eq('form_id', id)

  if (error) {
    logError('[capi-token] falha ao remover', error, { formId: id })
    return NextResponse.json({ error: 'Não foi possível remover.' }, { status: 500 })
  }

  log('[capi-token] token removido', { formId: id })
  return NextResponse.json({ ok: true })
}
