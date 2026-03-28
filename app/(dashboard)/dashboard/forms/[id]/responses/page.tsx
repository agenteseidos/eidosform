export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

// /dashboard/forms/[id]/responses → /forms/[id]/responses
export default async function DashboardFormsResponsesRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/forms/${id}/responses`)
}
