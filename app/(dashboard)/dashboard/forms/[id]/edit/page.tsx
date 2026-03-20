import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

// /dashboard/forms/[id]/edit → /forms/[id]/edit
export default async function DashboardFormsEditRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/forms/${id}/edit`)
}
