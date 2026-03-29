export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

// Compat route: /dashboard/forms/[id]/builder → /forms/[id]/builder
export default async function DashboardFormsBuilderRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/forms/${id}/builder`)
}
