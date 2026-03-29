export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

// Compat route: /forms/[id]/builder → /forms/[id]/edit
export default async function FormsBuilderRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/forms/${id}/edit`)
}
