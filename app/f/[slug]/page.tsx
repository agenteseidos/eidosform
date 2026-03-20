import { notFound } from 'next/navigation'
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
    .select('*')
    .eq('slug', slugOrId)
    .eq('status', 'published')
    .single()

  if (bySlug) return bySlug

  // If it looks like a UUID, also try by id
  if (UUID_RE.test(slugOrId)) {
    const { data: byId } = await supabase
      .from('forms')
      .select('*')
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

  const form = await fetchPublishedForm(supabase, slug) as { title: string; description: string | null } | null

  if (!form) {
    return { title: 'Formulário Não Encontrado' }
  }

  return {
    title: form.title || 'Formulário',
    description: form.description || 'Preencha este formulário',
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

  // Extract pixel config for SSR injection
  const pixels = (form.pixels || {}) as Record<string, string>
  const metaPixelId = pixels.metaPixelId || pixels.pixel_meta || null
  const canShowPixels = ownerPlan === 'plus' || ownerPlan === 'professional'

  return (
    <>
      {/* SSR-injected Meta Pixel for E2E/crawlers */}
      {canShowPixels && metaPixelId && (
        <script
          id="meta-pixel-ssr"
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`,
          }}
        />
      )}
      <FormPlayer form={form} ownerPlan={ownerPlan} />
    </>
  )
}
