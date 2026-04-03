'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MobileMenu() {
  const [open, setOpen] = useState(false)
  const canRenderPortal = typeof document !== 'undefined'

  useEffect(() => {
    if (!canRenderPortal) return

    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [canRenderPortal, open])

  const overlay = open ? (
    <div
      className="fixed inset-x-0 bottom-0 bg-[#0A0A0F]/98 backdrop-blur-xl border-t border-white/5 flex flex-col p-6 gap-6"
      style={{ top: '64px', zIndex: 99999 }}
    >
      <nav className="flex flex-col gap-2">
        {[
          { href: '#recursos', label: 'Recursos' },
          { href: '#como-funciona', label: 'Como funciona' },
          { href: '#precos', label: 'Preços' },
          { href: '#faq', label: 'FAQ' },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className="text-lg text-slate-300 hover:text-white transition-colors font-medium py-3 border-b border-white/5"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-3 pt-2">
        <Link href="/login" onClick={() => setOpen(false)}>
          <Button variant="ghost" className="w-full border border-white/20 text-slate-200 hover:bg-white/10 hover:text-white h-12">
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
  ) : null

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="h-11 w-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      {canRenderPortal && createPortal(overlay, document.body)}
    </div>
  )
}
