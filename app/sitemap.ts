import { MetadataRoute } from 'next'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: 'https://eidosform.com.br',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: 'https://eidosform.com.br/login',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  // Only fetch dynamic form entries when env vars are available (runtime, not build time)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return staticRoutes
  }

  try {
    const { createPublicClient } = await import('@/lib/supabase/public')
    const supabase = createPublicClient()
    const TEST_SLUG_PATTERNS = /(?:test|zefa|qa|debug)/i

    const { data: forms } = await supabase
      .from('forms')
      .select('slug, updated_at, is_public')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(1000)

    const formEntries: MetadataRoute.Sitemap = (forms ?? [])
      .filter((form: { slug: string; is_public?: boolean }) => {
        if (TEST_SLUG_PATTERNS.test(form.slug)) return false
        if (form.is_public === false) return false
        return true
      })
      .map((form: { slug: string; updated_at: string }) => ({
        url: `https://eidosform.com.br/f/${form.slug}`,
        lastModified: form.updated_at,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))

    return [...staticRoutes, ...formEntries]
  } catch {
    return staticRoutes
  }
}
