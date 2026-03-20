import { redirect } from 'next/navigation'

// /dashboard/billing redireciona para /billing
export default function DashboardBillingRedirect() {
  redirect('/billing')
}
