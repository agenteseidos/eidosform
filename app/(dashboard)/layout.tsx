import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardNav } from '@/components/dashboard/nav'

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

  return (
    <div className="light min-h-screen relative overflow-x-hidden" data-theme="light">
      {/* Sophisticated gradient background */}
      <div 
        className="fixed inset-0 z-0"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37, 99, 235, 0.06) 0%, transparent 50%), radial-gradient(ellipse 50% 40% at 100% 50%, rgba(59, 130, 246, 0.04) 0%, transparent 50%), linear-gradient(to bottom, #f8faff 0%, #fafbff 100%)',
        }}
      />
      <DashboardNav user={user} />
      <main className="relative z-10 pt-16">
        {children}
      </main>
    </div>
  )
}
