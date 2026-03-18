'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MobileMenu() {
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
        aria-label="Menu"
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {open && (
        <div className="fixed inset-0 top-16 z-40 bg-[#0A0A0F]/95 backdrop-blur-xl border-t border-white/5">
          <div className="flex flex-col p-6 gap-6">
            <nav className="flex flex-col gap-4">
              <a
                href="#recursos"
                onClick={() => setOpen(false)}
                className="text-lg text-slate-300 hover:text-white transition-colors font-medium"
              >
                Recursos
              </a>
              <a
                href="#como-funciona"
                onClick={() => setOpen(false)}
                className="text-lg text-slate-300 hover:text-white transition-colors font-medium"
              >
                Como funciona
              </a>
              <a
                href="#precos"
                onClick={() => setOpen(false)}
                className="text-lg text-slate-300 hover:text-white transition-colors font-medium"
              >
                Preços
              </a>
              <a
                href="#faq"
                onClick={() => setOpen(false)}
                className="text-lg text-slate-300 hover:text-white transition-colors font-medium"
              >
                FAQ
              </a>
            </nav>

            <div className="border-t border-white/5 pt-6 flex flex-col gap-3">
              <Link href="/login" onClick={() => setOpen(false)}>
                <Button variant="outline" className="w-full border-white/10 text-slate-300 hover:bg-white/5 hover:text-white">
                  Entrar
                </Button>
              </Link>
              <Link href="/login" onClick={() => setOpen(false)}>
                <Button className="w-full bg-[#F5B731] hover:bg-[#E8923A] text-black font-semibold shadow-lg shadow-[#F5B731]/20">
                  Criar conta grátis
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
