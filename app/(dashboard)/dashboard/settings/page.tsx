import { redirect } from 'next/navigation'

// /dashboard/settings redireciona para /settings
export default function DashboardSettingsRedirect() {
  redirect('/settings')
}
