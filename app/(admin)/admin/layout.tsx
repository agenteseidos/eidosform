import Link from 'next/link'
import { BarChart3, Shield, Users } from 'lucide-react'
import { requireAdminUser } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const navItems = [
  {
    href: '/admin',
    label: 'Métricas',
    icon: BarChart3,
  },
  {
    href: '/admin/users',
    label: 'Usuários',
    icon: Users,
  },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminUser()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 border-r border-slate-200 bg-white lg:block">
          <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Admin Panel</p>
              <p className="text-xs text-slate-500">EidosForm</p>
            </div>
          </div>

          <nav className="space-y-1 p-4">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-lg font-semibold">Admin Panel</h1>
                <p className="text-sm text-slate-500">Acesso restrito para administradores</p>
              </div>

              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Admin logado</p>
                <p className="text-sm font-medium text-slate-700">{user.email}</p>
              </div>
            </div>

            <nav className="flex gap-2 border-t border-slate-100 px-6 py-3 lg:hidden">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
