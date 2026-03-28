import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// /dashboard/settings redireciona para /settings
export default function DashboardSettingsRedirect() {
  redirect('/settings')
}
