import { notFound } from 'next/navigation'
import Script from 'next/script'
import { createPublicClient } from '@/lib/supabase/public'
import { FormPlayer } from '@/components/form-player/form-player'
import { Form } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface FormPageProps {
  params: Promise<{ slug: string }>
}

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function fetchPublishedForm(supabase: ReturnType<typeof createPublicClient>, slugOrId: string) {
  // Try by slug first
  const { data: bySlug } = await supabase
    .from('forms')
    .select('id, title, description, slug, questions, status, theme, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, hide_branding, user_id, pixel_event_on_start, pixel_event_on_complete')
    .eq('slug', slugOrId)
    .eq('status', 'published')
    .single()

  if (bySlug) return bySlug

  // If it looks like a UUID, also try by id
  if (UUID_RE.test(slugOrId)) {
    const { data: byId } = await supabase
      .from('forms')
      .select('id, title, description, slug, questions, status, theme, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, hide_branding, user_id, pixel_event_on_start, pixel_event_on_complete')
      .eq('id', slugOrId)
      .eq('status', 'published')
      .single()

    if (byId) return byId
  }

  return null
}

export async function generateMetadata({ params }: FormPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()

  const form = await fetchPublishedForm(supabase, slug) as { title: string; description: string | null; slug: string } | null

  if (!form) {
    return { title: 'Formulário Não Encontrado' }
  }

  const title = form.title || 'Formulário'
  const description = form.description || 'Preencha este formulário'
  const url = `https://eidosform.com.br/f/${form.slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'EidosForm',
      type: 'website',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
  }
}

export default async function FormPage({ params }: FormPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()

  const data = await fetchPublishedForm(supabase, slug)
  const form = data as (Form & { user_id: string }) | null

  if (!form) {
    notFound()
  }

  // Fetch owner's plan to gate pixel rendering
  let ownerPlan = 'free'
  if (form.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', form.user_id)
      .single() as { data: { plan: string } | null }
    if (profile?.plan) {
      ownerPlan = profile.plan
    }
  }

  // Extract Meta Pixel ID from form pixels config (suporte a camelCase e snake_case)
  const px = (form.pixels as Record<string, string> | null) ?? {}
  // Sanitize: Meta Pixel IDs are always numeric (15-16 digits) — strip any non-digits to prevent XSS
  const rawPixelId = px.metaPixelId || px.facebook || px.meta_pixel_id || px.pixel_meta || null
  const metaPixelId = rawPixelId && /^\d{10,20}$/.test(rawPixelId.trim()) ? rawPixelId.trim() : null
  const canShowPixels = ownerPlan === 'plus' || ownerPlan === 'professional'

  return (
    <>
      {/* Meta Pixel — injected server-side in <head> for reliable E2E detection */}
      {canShowPixels && metaPixelId && (
        <Script
          id="meta-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
          }}
        />
      )}
      <FormPlayer form={form} ownerPlan={ownerPlan} />
    </>
  )
}
