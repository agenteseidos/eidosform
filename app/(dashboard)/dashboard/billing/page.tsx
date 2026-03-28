import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// /dashboard/billing redireciona para /billing
export default function DashboardBillingRedirect() {
  redirect('/billing')
}
