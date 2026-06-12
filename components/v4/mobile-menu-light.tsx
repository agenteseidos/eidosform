'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Versão clara do menu mobile para a /v4 (fundo branco), com as âncoras
// corretas da v3/v4 (tráfego pago, agências, vs Typeform, preços, FAQ).
export function MobileMenuLight() {
  const [open, setOpen] = useState(false)
  const canRenderPortal = typeof document !== 'undefined'

  useEffect(() => {
    if (!canRenderPortal) return

    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [canRenderPortal, open])

  const overlay = (
    <div
      className={`fixed inset-x-0 bottom-0 bg-white/98 backdrop-blur-xl border-t border-slate-200 flex flex-col p-6 gap-6 transition-all duration-200 ${
        open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      style={{ top: '64px', zIndex: 99999 }}
    >
      <nav className="flex flex-col gap-2">
        {[
          { href: '#trafego-pago', label: 'Tráfego pago' },
          { href: '#agencias', label: 'Agências' },
          { href: '#comparativo', label: 'vs Typeform' },
          { href: '#precos', label: 'Preços' },
          { href: '#faq', label: 'FAQ' },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className="text-lg text-slate-700 hover:text-slate-900 transition-colors font-medium py-3 border-b border-slate-200"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-3 pt-2">
        <Link href="/login" onClick={() => setOpen(false)}>
          <Button variant="ghost" className="w-full border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-12">
            Entrar
          </Button>
        </Link>
        <Link href="/register" onClick={() => setOpen(false)}>
          <Button className="w-full bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold h-12 shadow-lg shadow-[#F5B731]/20">
            Criar conta grátis
          </Button>
        </Link>
      </div>
    </div>
  )

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="h-11 w-11 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all"
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      {canRenderPortal && createPortal(overlay, document.body)}
    </div>
  )
}
