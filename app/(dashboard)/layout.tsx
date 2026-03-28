import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardNav } from '@/components/dashboard/nav'

const MAX_PLAN = 'professional'

function normalizePlan(plan?: string | null) {
  const normalized = plan?.trim().toLowerCase()
  return normalized || 'free'
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const currentPlan = normalizePlan(profile?.plan)
  const showUpgradeButton = currentPlan !== MAX_PLAN

  return (
    <div className="light min-h-screen relative" data-theme="light">
      <div
        className="fixed inset-0 z-0"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37, 99, 235, 0.06) 0%, transparent 50%), radial-gradient(ellipse 50% 40% at 100% 50%, rgba(59, 130, 246, 0.04) 0%, transparent 50%), linear-gradient(to bottom, #f8faff 0%, #fafbff 100%)',
        }}
      />
      <DashboardNav user={user} showUpgradeButton={showUpgradeButton} />
      <main className="relative z-10 pt-16">
        {children}
      </main>
    </div>
  )
}
