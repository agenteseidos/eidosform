import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { createClient } from '@/lib/supabase/server'
import { FormUpdate } from '@/lib/database.types'
import { validateWebhookUrl } from '@/lib/webhook-validator'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { validateFormIntegrations } from '@/lib/form-integrations'
import { extractSpreadsheetId, connectSpreadsheet } from '@/lib/google-sheets'

// T1/T2: Ensure URLs have protocol before persisting
function ensureHttps(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!trimmed) return trimmed
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

  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
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
    .select('id, title, questions, google_sheets_id, google_sheets_enabled')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  const body = await req.json()
  const { title, description, slug, status, theme, questions, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, plan, redirect_url, webhook_url, pixel_event_on_start, pixel_event_on_complete, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, hide_branding, notify_email_enabled, notify_email, notify_whatsapp_enabled, notify_whatsapp_number, google_sheets_enabled, google_sheets_id, google_sheets_share_email, google_sheets_url } = body

  // Validate slug if provided
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must contain only lowercase letters, numbers, and hyphens' },
      { status: 400 }
    )
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
    .select('plan')
    .eq('id', user.id)
    .single()

  const userPlan = (profile?.plan ?? 'free') as PlanName
  const planConfig = PLANS[userPlan]

  // Validar plano para pixel events condicionais
  if (pixel_event_on_start !== undefined || pixel_event_on_complete !== undefined || hasPixelEventRules(questions)) {
    if (!planConfig?.pixels) {
      return NextResponse.json(
        { error: 'Eventos de pixel condicionais disponíveis a partir do plano Plus' },
        { status: 403 }
      )
    }
  }

  if (hide_branding === true && planConfig?.watermark) {
    return NextResponse.json(
      { error: 'hide_branding está disponível apenas em planos pagos sem marca d\'água' },
      { status: 403 }
    )
  }

  // Feature gate: webhooks
  if (webhook_url && !planConfig?.webhooks) {
    return NextResponse.json(
      { error: 'Webhooks disponíveis a partir do plano Plus' },
      { status: 403 }
    )
  }

  // Feature gate: email notifications
  if (notify_email_enabled === true && !planConfig?.emailNotifications) {
    return NextResponse.json(
      { error: 'Notificações por email disponíveis a partir do plano Plus' },
      { status: 403 }
    )
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

  // Google Sheets: connect to user-provided spreadsheet
  let connectedSheetsId: string | undefined
  let connectedSheetsTitle: string | undefined
  if (google_sheets_url) {
    const spreadsheetId = extractSpreadsheetId(google_sheets_url as string)
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'Link de planilha inválido. Cole a URL completa.' },
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
      console.error('Failed to connect Google Spreadsheet:', e)
      const gErr = e as { code?: number; errors?: Array<{ message?: string }> }
      if (gErr.code === 403) {
        return NextResponse.json(
          { error: 'Sem permissão para acessar essa planilha. Compartilhe com eidosform-sheets@eidosform.iam.gserviceaccount.com com permissão de Editor.' },
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
        { error: 'Não foi possível conectar a planilha agora. Tente novamente.' },
        { status: 500 }
      )
    }
  }

  // If disconnecting, clear the sheets ID
  if (google_sheets_enabled === false) {
    connectedSheetsId = undefined
  }

  const update: FormUpdate = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(slug !== undefined && { slug }),
    ...(status !== undefined && { status }),
    ...(theme !== undefined && { theme }),
    ...(questions !== undefined && { questions }),
    ...(thank_you_message !== undefined && { thank_you_message }),
    ...(thank_you_title !== undefined && { thank_you_title }),
    ...(thank_you_description !== undefined && { thank_you_description }),
    ...(thank_you_button_text !== undefined && { thank_you_button_text }),
    ...(thank_you_button_url !== undefined && { thank_you_button_url: ensureHttps(thank_you_button_url) }),
    ...(pixels !== undefined && { pixels }),
    ...(plan !== undefined && { plan }),
    ...(redirect_url !== undefined && { redirect_url: ensureHttps(redirect_url) }),
    ...(webhook_url !== undefined && { webhook_url }),
    ...(pixel_event_on_start !== undefined && { pixel_event_on_start }),
    ...(pixel_event_on_complete !== undefined && { pixel_event_on_complete }),
    ...(welcome_enabled !== undefined && { welcome_enabled }),
    ...(welcome_title !== undefined && { welcome_title }),
    ...(welcome_description !== undefined && { welcome_description }),
    ...(welcome_button_text !== undefined && { welcome_button_text }),
    ...(welcome_image_url !== undefined && { welcome_image_url }),
    ...(is_closed !== undefined && { is_closed }),
    ...(hide_branding !== undefined && { hide_branding }),
    ...(notify_email_enabled !== undefined && { notify_email_enabled }),
    ...(integrationValidation.values.notify_email !== undefined && { notify_email: integrationValidation.values.notify_email }),
    ...(notify_whatsapp_enabled !== undefined && { notify_whatsapp_enabled }),
    ...(integrationValidation.values.notify_whatsapp_number !== undefined && { notify_whatsapp_number: integrationValidation.values.notify_whatsapp_number }),
    ...(google_sheets_enabled !== undefined && { google_sheets_enabled }),
    ...(integrationValidation.values.google_sheets_id !== undefined && { google_sheets_id: integrationValidation.values.google_sheets_id }),
    ...(connectedSheetsId && { google_sheets_id: connectedSheetsId, google_sheets_enabled: true }),
    ...(google_sheets_enabled === false && { google_sheets_id: null }),
    ...(google_sheets_share_email !== undefined && { google_sheets_share_email }),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('forms')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    form: data,
    ...(connectedSheetsTitle && { google_sheets_title: connectedSheetsTitle }),
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

  const { error } = await supabase
    .from('forms')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 200 })
}


// Verifica se alguma pergunta tem regras de pixelEvents
function hasPixelEventRules(questions: unknown): boolean {
  if (!Array.isArray(questions)) return false
  return questions.some((q: { pixelEvents?: unknown[] }) => q.pixelEvents && q.pixelEvents.length > 0)
}
