import { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/public'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicClient()

  const { data: forms } = await supabase
    .from('forms')
    .select('slug, updated_at')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(1000)

  const formEntries: MetadataRoute.Sitemap = (forms ?? []).map((form: { slug: string; updated_at: string }) => ({
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
