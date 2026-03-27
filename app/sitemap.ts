import { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/public'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
      // Exclude test/QA forms by slug pattern
      if (TEST_SLUG_PATTERNS.test(form.slug)) return false
      // Only include public forms (if field exists, respect it)
      if (form.is_public === false) return false
      return true
    })
    .map((form: { slug: string; updated_at: string }) => ({
      url: `https://eidosform.com.br/f/${form.slug}`,
      lastModified: form.updated_at,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

  return [
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
    ...formEntries,
  ]
}
