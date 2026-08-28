import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanName, recomputeActiveForms } from '@/lib/plan-limits'
import { createClient } from '@/lib/supabase/server'
import { FormUpdate } from '@/lib/database.types'
import { validateWebhookUrl } from '@/lib/webhook-validator'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { validateFormIntegrations } from '@/lib/form-integrations'
import { extractSpreadsheetId, connectSpreadsheet } from '@/lib/google-sheets'
import { logError } from '@/lib/logger'
import { FormUpdateSchema, formatZodIssues } from '@/lib/schemas/form-schema'
import { sanitizeContentBlocksServer as sanitizeContentBlocks } from '@/lib/html-server'
import { isSafeUrl } from '@/lib/html'
import { getEffectivePlan } from '@/lib/plans'
import { canUseLeadWhatsApp } from '@/lib/whatsapp-capability'
import { detectNewlyActivatedRecipients, baselineAbandonedEmailClaims, type BaselineClient } from '@/lib/notification-baseline'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { parseThresholdMin } from '../../cron/abandoned-leads/route'

// T1/T2: Ensure URLs have protocol before persisting
function ensureHttps(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id] — get form by id
export async function GET(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const FORM_COLUMNS = 'id, user_id, folder_id, title, description, slug, status, is_public, is_published, theme, questions, thank_you_enabled, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, plan, redirect_url, redirect_delay, webhook_url, pixel_event_on_start, pixel_event_on_complete, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, paused, hide_branding, notify_email_enabled, notify_email, notify_owner_enabled, notify_whatsapp_enabled, notify_whatsapp_number, google_sheets_enabled, google_sheets_id, google_sheets_share_email, version, created_at, updated_at'

  const { data, error } = await supabase
    .from('forms')
    .select(FORM_COLUMNS)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    const code = error?.code
    if (code === 'PGRST116' || code === 'PGRST116' || !data) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }
    logError('GET /api/forms/[id] DB error', error, { id })
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }

  return NextResponse.json({ form: data })
}

// PATCH /api/forms/[id] — update form
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership
  const { data: existing } = await supabase
    .from('forms')
    .select('id, title, questions, google_sheets_id, google_sheets_enabled, version, notify_owner_enabled, notify_email_enabled, notify_email')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // 🚫 NUNCA purgar anexos aqui. Editar um formulário NÃO pode apagar os arquivos que os
  // respondentes enviaram — e por 10 dias apagou. O bloco de purga vivia nesta linha desde
  // 282a617 (17/08/2026): aquele commit corrigia um P0 real (a purga rodava ANTES do 401 no
  // DELETE, então qualquer um com o UUID apagava anexo alheio sem sessão) e, ao mover o bloco
  // para depois da prova de propriedade, moveu-o para o HANDLER ERRADO. O comentário órfão que
  // sobrou aqui — "exclusão do formulário nunca falha por causa do anexo" — falava de exclusão
  // dentro de uma atualização; era a impressão digital do engano.
  //
  // Efeito enquanto durou: o autosave do builder (4s de inatividade, teto de 30s, blur, publicar
  // e despublicar) destruía TODOS os anexos do formulário. Pior: a purga vinha ANTES de ler o
  // corpo, então até PATCH REJEITADO (payload inválido, 409 de duas abas) apagava. Zero perda
  // real por sorte — o único formulário com anexos não foi editado no período.
  //
  // A purga correta vive no DELETE, antes do `.delete()`. Travado por teste nos dois sentidos.
  const rawBody = await req.json()

  // P2-O: Payload size limit for PATCH (500KB)
  const bodyStr = JSON.stringify(rawBody)
  if (bodyStr.length > 500 * 1024) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // Etapa 7 — Zod schema validation (defense-in-depth before business rules).
  const parsed = FormUpdateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload inválido', issues: formatZodIssues(parsed.error) },
      { status: 400 }
    )
  }
  const body = parsed.data
  const { title, description, slug, status, theme, questions, thank_you_enabled, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, webhook_url, pixel_event_on_start, pixel_event_on_complete, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, hide_branding, notify_email_enabled, notify_email, notify_owner_enabled, notify_whatsapp_enabled, notify_whatsapp_number, google_sheets_enabled, google_sheets_id, google_sheets_share_email, google_sheets_url, expectedVersion } = body

  // P1-C: Ignore 'plan' field — plan is managed exclusively via billing/admin endpoints
  // Prevents users from escalating their own plan via PATCH

  // Validate meta_pixel_id if pixels object is provided
  if (pixels !== undefined && pixels !== null && typeof pixels === 'object') {
    const px = pixels as Record<string, string>
    const rawPixelId = px.metaPixelId || px.meta_pixel_id || px.facebook || null
    if (rawPixelId !== undefined && rawPixelId !== null && rawPixelId !== '') {
      if (!/^\d{10,20}$/.test(String(rawPixelId).trim())) {
        return NextResponse.json(
          { error: 'meta_pixel_id inválido. O ID do Meta Pixel deve conter apenas dígitos (10 a 20 caracteres).' },
          { status: 400 }
        )
      }
    }
  }

  // Validate webhook_url if provided
  if (webhook_url) {
    const webhookCheck = validateWebhookUrl(webhook_url)
    if (!webhookCheck.safe) {
      return NextResponse.json({ error: `Invalid webhook_url: ${webhookCheck.reason}` }, { status: 400 })
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, email, plan_status, asaas_subscription_id')
    .eq('id', user.id)
    .single()

  const userPlan = getEffectivePlan(profile) as PlanName
  const planConfig = PLANS[userPlan]

  // ── CAMPO DE PLANO SUPERIOR: IGNORA, NUNCA RECUSA (alinhamento Free, 2026-08) ─────────────
  //
  // Todos os gates abaixo devolviam 403 e derrubavam o salvamento INTEIRO. O construtor reenvia o
  // formulário completo em TODO autosave — inclusive os campos que já estavam gravados e que o
  // dono nem abriu. Então um Free que herdou webhook/pixel/redirect de um plano pago não
  // conseguia salvar NADA: nem corrigir um erro de digitação no título. Formulário em
  // somente-leitura permanente, sem saída, porque o controle na tela virou cadeado e não oferece
  // como apagar o valor.
  //
  // Quem sempre foi Free nunca vive isso — na CRIAÇÃO (`app/api/forms/route.ts`) esses campos já
  // são descartados em silêncio. O 403 aqui era, por construção, uma regra que só existia de um
  // lado. E o padrão certo já estava neste mesmo arquivo, nos campos de WhatsApp, com o motivo
  // escrito: "recusar o payload quebraria o salvamento inteiro de todos os clientes".
  //
  // ⚠️ IGNORAR = OMITIR do objeto `update`, jamais reescrever o valor persistido de volta. Assim
  // o dado herdado fica intacto (decisão do Sidney: "manter lá, sem funcionar; quando voltar a
  // pagar, tudo reativa") e reverter esta mudança não deixa resíduo.
  //
  // Isto NÃO libera recurso pago: quem decide se o webhook dispara, se o pixel carrega ou se o
  // e-mail sai é o gate de ENTREGA, que continua olhando o plano em cada disparo.
  //
  // 📌 API pública: a decisão do Sidney é RECUSAR com erro explícito (programador precisa saber
  // que a ordem dele foi descartada). Hoje não há onde aplicar — `app/api/v1/forms/[id]/route.ts`
  // tem apenas OPTIONS, GET e POST; não existe PATCH v1. Quando existir, ele recusa; esta rota,
  // que é a do navegador, continua ignorando.
  const ignoredFields: string[] = []
  const podeUsar = {
    pixels: Boolean(planConfig?.pixels),
    webhooks: Boolean(planConfig?.webhooks),
    redirect: Boolean(planConfig?.redirect),
    emailNotifications: Boolean(planConfig?.emailNotifications),
    semMarca: !planConfig?.watermark,
  }

  // P1-E: payload de perguntas — tamanho e URLs continuam sendo erro de verdade.
  if (questions !== undefined && Array.isArray(questions)) {
    const serializedSize = JSON.stringify(questions).length
    if (serializedSize > 500_000) {
      return NextResponse.json(
        { error: 'Payload de perguntas excede 500KB. Reduza o tamanho das perguntas.' },
        { status: 413 }
      )
    }
    const urlError = validateQuestionUrls(questions)
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 })
    }

    // TETO DE PERGUNTAS: trava o CRESCIMENTO, não a edição.
    //
    // Antes, qualquer salvamento de um formulário acima do teto era recusado — o dono de um
    // formulário legado de 40 perguntas não conseguia nem renomear uma pergunta. Agora ele edita
    // à vontade e só não pode AUMENTAR. O formulário nunca cresce, apodrece sozinho, e reduzir
    // até o teto o reativa (`recomputeActiveForms`, ao fim deste handler).
    const maxQuestions = planConfig?.maxQuestions ?? 25
    const atuais = Array.isArray((existing as { questions?: unknown }).questions)
      ? ((existing as { questions: unknown[] }).questions).length
      : 0
    if (questions.length > maxQuestions && questions.length > atuais) {
      return NextResponse.json(
        {
          error: atuais > maxQuestions
            ? `Este formulário tem ${atuais} perguntas e seu plano (${userPlan}) permite ${maxQuestions}. Você pode editar e remover perguntas, mas não adicionar novas.`
            : `Limite de ${maxQuestions} perguntas por formulário atingido (seu plano: ${userPlan})`,
        },
        { status: 403 }
      )
    }
  }

  if (pixels !== undefined && pixels !== null && typeof pixels === 'object') {
    const px = pixels as Record<string, unknown>
    const hasPixels = Object.values(px).some(v => v !== null && v !== undefined && v !== '')
    if (hasPixels && !podeUsar.pixels) ignoredFields.push('pixels')
  }
  if (((pixel_event_on_start !== undefined && pixel_event_on_start !== null) ||
       (pixel_event_on_complete !== undefined && pixel_event_on_complete !== null) ||
       hasPixelEventRules(questions)) && !podeUsar.pixels) {
    ignoredFields.push('pixel_events')
  }
  if (hide_branding === true && !podeUsar.semMarca) ignoredFields.push('hide_branding')
  if (webhook_url && !podeUsar.webhooks) ignoredFields.push('webhook_url')
  if (redirect_url && !podeUsar.redirect) ignoredFields.push('redirect_url')
  if (notify_email_enabled === true && !podeUsar.emailNotifications) ignoredFields.push('notify_email_enabled')

  // P1-H: Validate welcome_image_url if provided
  if (welcome_image_url !== undefined && welcome_image_url !== null && welcome_image_url !== '') {
    try {
      const imgUrl = new URL(welcome_image_url)
      if (!['https:', 'http:'].includes(imgUrl.protocol)) {
        return NextResponse.json(
          { error: 'welcome_image_url deve usar HTTP ou HTTPS' },
          { status: 400 }
        )
      }
      // Block private IPs in image URL (SSRF prevention)
      const hostname = imgUrl.hostname.toLowerCase()
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
        return NextResponse.json(
          { error: 'welcome_image_url não pode apontar para localhost' },
          { status: 400 }
        )
      }
      // P2-B: Block SVG files (XSS risk when rendered as img src in some browsers)
      const pathname = imgUrl.pathname.toLowerCase()
      if (pathname.endsWith('.svg') || pathname.endsWith('.svgz')) {
        return NextResponse.json(
          { error: 'SVG não é permitido como imagem de boas-vindas' },
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'welcome_image_url inválido' },
        { status: 400 }
      )
    }
  }

  const integrationValidation = validateFormIntegrations({
    notify_email,
    notify_whatsapp_number,
    google_sheets_id,
  })

  if (!integrationValidation.valid) {
    return NextResponse.json(
      { error: 'Dados de integração inválidos', details: integrationValidation.errors },
      { status: 400 }
    )
  }

  // ── UX-notificações, corte SEM FILA RETROATIVA (pedido Sidney 05/08) ───────
  // Se este save faz um destinatário de e-mail PASSAR A EXISTIR (chave do dono
  // religada, e-mail adicional ativado/preenchido), cada abandono JÁ existente
  // do formulário ganha claim-baseline ANTES de a chave ligar: o cron passa a
  // enviar só abandono novo. Fail-closed de propósito — sem baseline a chave
  // não liga, senão o acervo de 72h desagua no destinatário novo de uma vez
  // (a rajada de 10 "Lead incompleto" num minuto de 05/08).
  const prevNotify = existing as unknown as {
    notify_owner_enabled: boolean | null
    notify_email_enabled: boolean | null
    notify_email: string | null
  }
  const newlyActivated = detectNewlyActivatedRecipients({
    prev: {
      notify_owner_enabled: prevNotify.notify_owner_enabled ?? null,
      notify_email_enabled: prevNotify.notify_email_enabled ?? null,
      notify_email: prevNotify.notify_email ?? null,
    },
    next: {
      ...(notify_owner_enabled !== undefined && { notify_owner_enabled: notify_owner_enabled === true }),
      ...(notify_email_enabled !== undefined && !ignoredFields.includes('notify_email_enabled') && { notify_email_enabled }),
      ...(integrationValidation.values.notify_email !== undefined && { notify_email: integrationValidation.values.notify_email }),
    },
    ownerEmail: (profile as { email?: string | null } | null)?.email,
  })
  if (newlyActivated.length > 0) {
    const thresholdMin = parseThresholdMin(process.env.ABANDONED_LEAD_MINUTES)
    if (thresholdMin === null) {
      logError('PATCH /api/forms/[id] baseline: ABANDONED_LEAD_MINUTES inválido — chave NÃO ativada', null, { id })
      return NextResponse.json(
        { error: 'Não foi possível ativar a notificação agora. Tente novamente em instantes.' },
        { status: 500 }
      )
    }
    try {
      await baselineAbandonedEmailClaims({
        client: createServiceRoleClient() as unknown as BaselineClient,
        formId: id,
        recipients: newlyActivated,
        thresholdMin,
      })
    } catch (e) {
      logError('PATCH /api/forms/[id] baseline de abandono falhou — chave NÃO ativada', e, { id })
      return NextResponse.json(
        { error: 'Não foi possível ativar a notificação agora. Tente novamente em instantes.' },
        { status: 500 }
      )
    }
  }

  // Google Sheets: connect to user-provided spreadsheet
  let connectedSheetsId: string | undefined
  let connectedSheetsTitle: string | undefined
  if (google_sheets_url) {
    if (!PLANS[userPlan]?.googleSheets) {
      return NextResponse.json(
        { error: 'Integração com Google Sheets disponível a partir do plano Starter.' },
        { status: 403 }
      )
    }
    const spreadsheetId = extractSpreadsheetId(google_sheets_url as string)
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'Link de planilha inválido. Cole a URL completa do Google Sheets.' },
        { status: 400 }
      )
    }

    try {
      const formQuestions = (questions ?? existing.questions ?? []) as Array<{ id: string; title: string }>
      const fieldLabels = formQuestions.map((q) => q.title || 'Sem título')
      const result = await connectSpreadsheet(spreadsheetId, fieldLabels)
      connectedSheetsId = spreadsheetId
      connectedSheetsTitle = result.title
    } catch (e: unknown) {
      logError('Failed to connect Google Spreadsheet:', e)
      const gErr = e as { code?: number; errors?: Array<{ message?: string }> }
      if (gErr.code === 403) {
        return NextResponse.json(
          { error: 'Não foi possível acessar a planilha. Verifique se compartilhou com o e-mail do serviço.' },
          { status: 400 }
        )
      }
      if (gErr.code === 404) {
        return NextResponse.json(
          { error: 'Planilha não encontrada. Verifique se a URL está correta e se a planilha não foi excluída.' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'Não foi possível conectar a planilha. Tente novamente.' },
        { status: 500 }
      )
    }
  }

  // If disconnecting, clear the sheets ID
  if (google_sheets_enabled === false) {
    connectedSheetsId = undefined
  }

  // P0-FB1: server-side sanitize content_block bodies before persisting.
  const sanitizedQuestions = questions !== undefined
    ? (sanitizeContentBlocks(questions) as FormUpdate['questions'])
    : undefined

  // Camada 1 — controle de concorrência otimista. A versão sempre incrementa neste
  // save; se o cliente mandou `expectedVersion`, o UPDATE abaixo só casa a linha se ela
  // ainda estiver nessa versão (senão = outra aba alterou no intervalo -> 409).
  const currentVersion = (existing as { version?: number | null }).version ?? 0
  const nextVersion = (expectedVersion ?? currentVersion) + 1

  const update: FormUpdate = {
    version: nextVersion,
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(slug !== undefined && { slug }),
    ...(status !== undefined && { status }),
    ...(theme !== undefined && { theme }),
    ...(sanitizedQuestions !== undefined && { questions: sanitizedQuestions }),
    ...(thank_you_enabled !== undefined && { thank_you_enabled }),
    ...(thank_you_message !== undefined && { thank_you_message }),
    ...(thank_you_title !== undefined && { thank_you_title }),
    ...(thank_you_description !== undefined && { thank_you_description }),
    ...(thank_you_button_text !== undefined && { thank_you_button_text }),
    ...(thank_you_button_url !== undefined && { thank_you_button_url: ensureHttps(thank_you_button_url) }),
    // Campos de plano superior: OMITIDOS quando ignorados — o valor herdado fica intacto no
    // banco (nunca é reescrito), então reverter isto não deixa resíduo.
    ...(pixels !== undefined && !ignoredFields.includes('pixels') && { pixels: pixels as FormUpdate['pixels'] }),
    ...(redirect_url !== undefined && !ignoredFields.includes('redirect_url') && { redirect_url: ensureHttps(redirect_url) }),
    ...(webhook_url !== undefined && !ignoredFields.includes('webhook_url') && { webhook_url }),
    ...(pixel_event_on_start !== undefined && !ignoredFields.includes('pixel_events') && { pixel_event_on_start }),
    ...(pixel_event_on_complete !== undefined && !ignoredFields.includes('pixel_events') && { pixel_event_on_complete }),
    ...(welcome_enabled !== undefined && { welcome_enabled }),
    ...(welcome_title !== undefined && { welcome_title }),
    ...(welcome_description !== undefined && { welcome_description }),
    ...(welcome_button_text !== undefined && { welcome_button_text }),
    ...(welcome_image_url !== undefined && { welcome_image_url }),
    ...(is_closed !== undefined && { is_closed }),
    ...(hide_branding !== undefined && !ignoredFields.includes('hide_branding') && { hide_branding }),
    ...(notify_email_enabled !== undefined && { notify_email_enabled }),
    // Toggle do DONO (UX-notificações 05/08): sem gate de plano — default é true
    // e desligar é inócuo em plano sem e-mail (o gate de envio é por plano).
    ...(notify_owner_enabled !== undefined && { notify_owner_enabled: notify_owner_enabled === true }),
    ...(integrationValidation.values.notify_email !== undefined && { notify_email: integrationValidation.values.notify_email }),
    // Campos LEGADOS de WhatsApp: IGNORADOS para quem não tem a capacidade
    // (2026-07-30). São ignorados, NUNCA rejeitados — o builder envia
    // `notify_whatsapp_*` em TODO autosave, mesmo sem o usuário abrir o painel;
    // recusar o payload quebraria o salvamento inteiro de todos os clientes.
    // (Hoje esses campos são inertes: o envio real lê `form_whatsapp_settings`.)
    ...(canUseLeadWhatsApp(user.id) && notify_whatsapp_enabled !== undefined && { notify_whatsapp_enabled }),
    ...(canUseLeadWhatsApp(user.id) && integrationValidation.values.notify_whatsapp_number !== undefined && { notify_whatsapp_number: integrationValidation.values.notify_whatsapp_number }),
    ...(google_sheets_enabled !== undefined && { google_sheets_enabled }),
    ...(integrationValidation.values.google_sheets_id !== undefined && { google_sheets_id: integrationValidation.values.google_sheets_id }),
    ...(connectedSheetsId && { google_sheets_id: connectedSheetsId, google_sheets_enabled: true }),
    ...(google_sheets_enabled === false && { google_sheets_id: null }),
    ...(google_sheets_share_email !== undefined && { google_sheets_share_email }),
    updated_at: new Date().toISOString(),
  }

  let updateQuery = supabase
    .from('forms')
    .update(update)
    .eq('id', id)
  // Guard otimista: só aplica se a versão no banco ainda for a que o cliente tinha.
  // Sem expectedVersion (cliente antigo), cai em update cego — comportamento legado.
  if (expectedVersion !== undefined) {
    updateQuery = updateQuery.eq('version', expectedVersion)
  }

  const { data, error } = await updateQuery.select().single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    }
    // PGRST116 = nenhuma linha casou. Com guard de versão ligado, isso significa que
    // outra aba/sessão alterou o form no intervalo (lost update evitado).
    if (expectedVersion !== undefined && error.code === 'PGRST116') {
      return NextResponse.json(
        {
          error: 'O formulário foi alterado em outra aba ou sessão. Recarregue para ver a versão mais recente antes de salvar.',
          code: 'version_conflict',
          currentVersion,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }

  // RECALCULA O QUE FICA NO AR (alinhamento Free, item 2).
  //
  // É o que faz "reduzir as perguntas reativa o formulário" acontecer de verdade: o dono corta a
  // anamnese de 40 para 25, salva, e ela volta sozinha — sem pagar, sem suporte, sem esperar cron.
  //
  // Só roda em plano COM teto (free/starter). Best-effort de propósito: o salvamento já foi
  // gravado com sucesso e não pode ser desfeito porque o recálculo falhou — o próximo salvamento,
  // ou o próximo downgrade, corrige. Mas o erro fica no log; silêncio aqui já custou caro neste
  // projeto.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const temTeto = (PLANS[userPlan]?.maxForms ?? -1) >= 0
  if (serviceKey && temTeto) {
    try {
      await recomputeActiveForms(serviceKey, user.id, userPlan)
    } catch (err) {
      logError('PATCH /api/forms/[id]: recálculo de formulários ativos falhou', err, { id, userPlan })
    }
  }

  return NextResponse.json({
    form: data,
    ...(connectedSheetsTitle && { google_sheets_title: connectedSheetsTitle }),
    // Campos de plano superior que vieram no payload e foram DESCARTADOS. A tela usa isto para
    // avisar sem alarmar — o salvamento deu certo, só aquele campo não entrou.
    ...(ignoredFields.length > 0 && { ignored_fields: ignoredFields }),
  })
}

// PUT /api/forms/[id] — update form (alias for PATCH, used by frontend)
export const PUT = PATCH

// DELETE /api/forms/[id] — delete form
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership before deleting
  const { data: existing } = await supabase
    .from('forms')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // ANEXOS: revoga o link e apaga o objeto ANTES do `.delete()` — depois do cascade as fichas
  // de `form_files` somem e o arquivo ficaria órfão e VIVO no storage, contrariando a política
  // de privacidade publicada ("dados deletados em até 30 dias").
  //
  // Aqui, e só aqui: `user` já autenticou e `existing` já provou a propriedade — foi este o P0
  // de 16/08 (purga antes do 401 = destruição de dado por requisição anônima). Best-effort: a
  // exclusão do formulário não se desfaz porque o storage teve um soluço; o que falhar fica
  // revogado (link morto) e a varredura de órfãos recolhe depois.
  try {
    const { purgarAnexos } = await import('@/lib/form-file-purge')
    const { createServiceRoleClient } = await import('@/lib/supabase/service-role')
    await purgarAnexos(createServiceRoleClient(), { formId: id })
  } catch (err) {
    logError('DELETE /api/forms/[id]: purga de anexos falhou (exclusão segue)', err, { id })
  }

  const { error } = await supabase
    .from('forms')
    .delete()
    .eq('id', id)

  if (error) {
    logError('Failed to delete form:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }

  // APAGAR LIBERA A VAGA (alinhamento Free, item 4).
  //
  // Antes, um rebaixado com 10 formulários (3 no ar, 7 pausados) que apagasse os 7 continuava com
  // 3 pausados — para sempre. Nenhuma rotina recalculava fora do momento do downgrade. Ele ficava
  // com MENOS formulários úteis que alguém que acabou de se cadastrar, sem ação nenhuma capaz de
  // consertar. A regra do Sidney — os dois terminam no mesmo lugar — exige este recálculo.
  //
  // Best-effort: a exclusão já aconteceu e não se desfaz por causa disto. Erro vai para o log.
  const { data: perfil } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_status, asaas_subscription_id')
    .eq('id', user.id)
    .single()
  const plano = getEffectivePlan(perfil) as PlanName
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey && (PLANS[plano]?.maxForms ?? -1) >= 0) {
    try {
      await recomputeActiveForms(serviceKey, user.id, plano)
    } catch (err) {
      logError('DELETE /api/forms/[id]: recálculo de formulários ativos falhou', err, { id, plano })
    }
  }

  return NextResponse.json({ success: true }, { status: 200 })
}


// Verifica se alguma pergunta tem regras de pixelEvents
function hasPixelEventRules(questions: unknown): boolean {
  if (!Array.isArray(questions)) return false
  return questions.some((q: { pixelEvents?: unknown[] }) => q.pixelEvents && q.pixelEvents.length > 0)
}

function validateQuestionUrls(questions: unknown[]): string | null {
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue
    const question = q as Record<string, unknown>
    if (!isSafeUrl(question.contentButtonUrl)) {
      return 'URL inválida em contentButtonUrl: protocolo não permitido'
    }
    if (!isSafeUrl(question.imageUrl)) {
      return 'URL inválida em imageUrl: protocolo não permitido'
    }
    if (!isSafeUrl(question.videoUrl)) {
      return 'URL inválida em videoUrl: protocolo não permitido'
    }
  }
  return null
}
