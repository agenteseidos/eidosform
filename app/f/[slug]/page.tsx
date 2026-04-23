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
    .select('id, title, description, slug, questions, status, theme, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, paused, hide_branding, pixel_event_on_start, pixel_event_on_complete')
    .eq('slug', slugOrId)
    .eq('status', 'published')
    .single()

  if (bySlug) return bySlug

  // If it looks like a UUID, also try by id
  if (UUID_RE.test(slugOrId)) {
    const { data: byId } = await supabase
      .from('forms')
      .select('id, title, description, slug, questions, status, theme, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, paused, hide_branding, pixel_event_on_start, pixel_event_on_complete')
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

  const form = await fetchPublishedForm(supabase, slug) as { id: string; title: string; description: string | null; slug: string } | null

  if (!form) {
    return { title: 'Formulário Não Encontrado' }
  }

  const title = form.title || 'Formulário'
  const description = form.description || 'Preencha este formulário'
  const url = `https://eidosform.com.br/f/${form.slug}`

  // Fetch owner plan for white-label OG tags
  let ownerPlan = 'free'
  try {
    const planRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'}/api/forms/${form.id}/plan`, {
      next: { revalidate: 3600 },
    })
    if (planRes.ok) {
      const { plan } = await planRes.json()
      ownerPlan = plan
    }
  } catch { /* ignore */ }

  const isWhiteLabel = ownerPlan === 'professional'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: isWhiteLabel ? title : 'EidosForm',
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
  const form = data as Form | null

  if (!form) {
    notFound()
  }

  // Fetch owner's plan to gate pixel rendering
  let ownerPlan = 'free'
  try {
    const planResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'}/api/forms/${form.id}/plan`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })
    if (planResponse.ok) {
      const { plan } = await planResponse.json()
      ownerPlan = plan
    }
  } catch {
    // Fallback to free if plan fetch fails
    ownerPlan = 'free'
  }

  // Extract Meta Pixel ID from form pixels config (suporte a camelCase e snake_case)
  const px = (form.pixels as Record<string, string> | null) ?? {}
  // Sanitize: Meta Pixel IDs are always numeric (15-16 digits) — strip any non-digits to prevent XSS
  const rawPixelId = px.metaPixelId || px.facebook || px.meta_pixel_id || px.pixel_meta || null
  const metaPixelId = rawPixelId && /^\d{10,20}$/.test(rawPixelId.trim()) ? rawPixelId.trim() : null
  const canShowPixels = ownerPlan === 'plus' || ownerPlan === 'professional'

  // White-label: force hide_branding for Plus and Professional plans
  if ((ownerPlan === 'plus' || ownerPlan === 'professional') && !form.hide_branding) {
    form.hide_branding = true as unknown as typeof form.hide_branding
  }

  // Gate pixel data: strip from payload if plan doesn't allow pixels
  if (!canShowPixels && form.pixels) {
    form.pixels = null as unknown as typeof form.pixels
  }

  // Detect if form is loaded inside an iframe
  // Note: We can't reliably detect iframe server-side in all cases,
  // so we pass the info to the client component for enforcement
  const canEmbed = ownerPlan === 'plus' || ownerPlan === 'professional'

  // Paused form (downgrade) — show paused message instead of form
  if ((form as { paused?: boolean }).paused) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-50 to-white">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">
            Formulário pausado
          </h1>
          <p className="text-slate-600">
            Este formulário está temporariamente indisponível. O criador do formulário precisa atualizar seu plano para reativá-lo.
          </p>
        </div>
      </div>
    )
  }

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
      <FormPlayer form={form} ownerPlan={ownerPlan} allowEmbed={canEmbed} />
    </>
  )
}
