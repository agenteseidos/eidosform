import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Script from 'next/script'
import { createPublicClient } from '@/lib/supabase/public'
import { FormPlayer } from '@/components/form-player/form-player'
import { Form } from '@/lib/database.types'
import { getEffectivePlan } from '@/lib/plans'

export const dynamic = 'force-dynamic'

interface FormPageProps {
  params: Promise<{ slug: string }>
}

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function fetchOwnerPlan(supabase: ReturnType<typeof createPublicClient>, formId: string): Promise<string> {
  const { data: form } = await supabase
    .from('forms')
    .select('user_id')
    .eq('id', formId)
    .single()
  if (!form?.user_id) return 'free'
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', form.user_id)
    .single()
  // Considera expiração: plano pago vencido conta como free (P1-3).
  return getEffectivePlan(profile)
}

async function fetchPublishedForm(supabase: ReturnType<typeof createPublicClient>, slugOrId: string) {
  // Try by slug first
  const { data: bySlug } = await supabase
    .from('forms')
    .select('id, title, description, slug, questions, status, theme, thank_you_enabled, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, paused, hide_branding, pixel_event_on_start, pixel_event_on_complete, google_sheets_enabled')
    .eq('slug', slugOrId)
    .eq('status', 'published')
    .single()

  if (bySlug) return bySlug

  // If it looks like a UUID, also try by id
  if (UUID_RE.test(slugOrId)) {
    const { data: byId } = await supabase
      .from('forms')
      .select('id, title, description, slug, questions, status, theme, thank_you_enabled, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, redirect_url, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url, is_closed, paused, hide_branding, pixel_event_on_start, pixel_event_on_complete, google_sheets_enabled')
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
  const ownerPlan = await fetchOwnerPlan(supabase, form.id)

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
  // Nonce da CSP por request (A2) — gerado no middleware, exigido pelos
  // browsers modernos em qualquer script inline desta página.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  const data = await fetchPublishedForm(supabase, slug)
  const form = data as Form | null

  if (!form) {
    notFound()
  }

  // Fetch owner's plan to gate pixel rendering
  const ownerPlan = await fetchOwnerPlan(supabase, form.id)

  // Extract Meta Pixel ID from form pixels config (suporte a camelCase e snake_case)
  const px = (form.pixels as Record<string, string> | null) ?? {}
  // Sanitize: Meta Pixel IDs are always numeric (15-16 digits) — strip any non-digits to prevent XSS
  const rawPixelId = px.metaPixelId || px.facebook || px.meta_pixel_id || px.pixel_meta || null
  const metaPixelId = rawPixelId && /^\d{10,20}$/.test(rawPixelId.trim()) ? rawPixelId.trim() : null
  const canShowPixels = ownerPlan === 'plus' || ownerPlan === 'professional'

  // Google Tag Manager + Google Ads — injetados server-side (igual ao Meta Pixel)
  // para detecção confiável (Tag Assistant) em todas as telas do player.
  // Sanitize: só formatos válidos de ID entram no HTML inline (previne XSS).
  const rawGtmId = px.gtmId || px.gtm_id || null
  const gtmId = canShowPixels && rawGtmId && /^GTM-[A-Z0-9]+$/i.test(rawGtmId.trim()) ? rawGtmId.trim() : null
  const rawGoogleAdsId = px.googleAdsId || px.google_ads_id || null
  const googleAdsId = canShowPixels && rawGoogleAdsId && /^AW-\d+$/.test(rawGoogleAdsId.trim()) ? rawGoogleAdsId.trim() : null
  // TikTok Pixel — IDs são alfanuméricos (ex: CXXXXXXXXXXXXXXXXX); só [A-Za-z0-9] entra no HTML inline (previne XSS)
  const rawTiktokPixelId = px.tiktokPixelId || px.tiktok_pixel_id || null
  const tiktokPixelId = canShowPixels && rawTiktokPixelId && /^[A-Za-z0-9]{10,40}$/.test(rawTiktokPixelId.trim()) ? rawTiktokPixelId.trim() : null

  // Marca "Feito com EidosForm": free/starter sempre exibem (watermark
  // obrigatório — o toggle fica travado no builder); plus/professional
  // decidem pelo toggle hide_branding salvo no form. Antes esta regra
  // FORÇAVA hide_branding=true em todo plano pago, ignorando a escolha
  // do dono (toggle "Ocultar" desligado não tinha efeito).
  const ownerCanHideBranding = ownerPlan === 'plus' || ownerPlan === 'professional'
  if (!ownerCanHideBranding) {
    form.hide_branding = false
  }

  // Gate pixel data: strip from payload if plan doesn't allow pixels
  if (!canShowPixels && form.pixels) {
    form.pixels = null
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
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
          }}
        />
      )}

      {/* Google Tag Manager — container injetado server-side para detecção confiável */}
      {gtmId && (
        <>
          <Script
            id="gtm"
            strategy="afterInteractive"
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
            }}
          />
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        </>
      )}

      {/* Google Ads (gtag) — carrega a lib e configura o ID de conversão */}
      {googleAdsId && (
        <>
          <Script
            id="google-ads-lib"
            strategy="afterInteractive"
            nonce={nonce}
            src={`https://www.googletagmanager.com/gtag/js?id=${googleAdsId}`}
          />
          <Script
            id="google-ads-init"
            strategy="afterInteractive"
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${googleAdsId}');`,
            }}
          />
        </>
      )}

      {/* TikTok Pixel — snippet oficial ttq, injetado server-side igual aos demais */}
      {tiktokPixelId && (
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load('${tiktokPixelId}');ttq.page();}(window,document,'ttq');`,
          }}
        />
      )}

      <FormPlayer form={form} ownerPlan={ownerPlan} allowEmbed={canEmbed} />
    </>
  )
}
