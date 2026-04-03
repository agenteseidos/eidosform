'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { EidosLogo } from '@/components/ui/eidos-logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User } from '@supabase/supabase-js'
import { LogOut, Settings, User as UserIcon, CreditCard, Menu, X } from 'lucide-react'
import { toast } from 'sonner'

interface DashboardNavProps {
  user: User
  showUpgradeButton?: boolean
}

export function DashboardNav({ user, showUpgradeButton = false }: DashboardNavProps) {
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error('Falha ao sair')
    } else {
      router.push('/')
      router.refresh()
    }
  }

  const [mobileOpen, setMobileOpen] = useState(false)
  const initials = user.email?.slice(0, 2).toUpperCase() || 'U'
  const avatarUrl = user.user_metadata?.avatar_url

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <EidosLogo variant="reduced" theme="light" href="/dashboard" height={34} />
            <div className="hidden md:flex items-center gap-6">
              <Link
                href="/dashboard"
                className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                Meus Formulários
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/forms/new">
              <Button className="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30 hover:-translate-y-0.5">
                <span className="hidden sm:inline">Criar Formulário</span>
                <span className="sm:hidden">+</span>
              </Button>
            </Link>

            {showUpgradeButton && (
              <Link href="/billing" className="hidden md:block">
                <Button className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold shadow-lg shadow-yellow-400/25">
                  Fazer upgrade
                </Button>
              </Link>
            )}

            <Button variant="ghost" size="sm" className="md:hidden h-11 w-11 p-0 flex items-center justify-center" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={avatarUrl} alt={user.email || 'Usuário'} />
                    <AvatarFallback className="bg-blue-600 text-white font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    {user.user_metadata?.full_name && (
                      <p className="font-medium">{user.user_metadata.full_name}</p>
                    )}
                    <p className="text-sm text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer">
                    <UserIcon className="mr-2 h-4 w-4" />
                    Meus Formulários
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/billing" className="cursor-pointer">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Planos & Cobrança
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Configurações
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div className="md:hidden fixed top-16 left-0 right-0 z-40 bg-white border-b border-slate-200 shadow-lg px-6 py-4 flex flex-col gap-3">
          <Link href="/dashboard" className="text-sm font-medium text-slate-700 hover:text-slate-900" onClick={() => setMobileOpen(false)}>
            Meus Formulários
          </Link>
          <Link href="/forms/new" className="text-sm font-medium text-blue-600 hover:text-blue-700" onClick={() => setMobileOpen(false)}>
            + Criar Formulário
          </Link>
          {showUpgradeButton && (
            <Link href="/billing" className="text-sm font-semibold text-yellow-700 hover:text-yellow-800" onClick={() => setMobileOpen(false)}>
              ✨ Fazer upgrade
            </Link>
          )}
          <Link href="/settings" className="text-sm font-medium text-slate-700 hover:text-slate-900" onClick={() => setMobileOpen(false)}>
            Configurações
          </Link>
          <button onClick={() => { setMobileOpen(false); handleSignOut() }} className="text-sm font-medium text-red-600 hover:text-red-700 text-left">
            Sair
          </button>
        </div>
      )}
    </>
  )
}
