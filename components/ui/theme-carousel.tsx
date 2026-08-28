'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { themeList } from '@/lib/themes'
import type { ThemeConfig } from '@/lib/database.types'

// Carrossel de TODOS os temas (itera `themeList`) na seção "Sua marca" das landings (/v3 e /v4).
// Mesma lógica do carrossel de vídeos da LP do Instituto Luiz Almeida:
// deriva contínua para a esquerda via rAF, loop infinito com o conjunto
// triplicado, pausa no hover/toque, setas com ease-out cúbico, e
// prefers-reduced-motion desliga a deriva (setas passam a ser instantâneas).
// O swipe manual do usuário é adotado como nova posição, nunca disputado.

const GAP = 14 // precisa bater com o gap-3.5 do track
const SPEED = 24 // px/s da deriva

function ThemeCard({ t, variant }: { t: ThemeConfig; variant: 'dark' | 'light' }) {
  const border =
    variant === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)'
  return (
    <div
      className="w-[185px] shrink-0 rounded-2xl border p-4 select-none"
      style={{ backgroundColor: t.backgroundColor, borderColor: border }}
      aria-hidden
    >
      <div
        className="w-9 h-9 rounded-full border flex items-center justify-center mb-3 text-[10px] font-black"
        style={{
          backgroundColor: `${t.primaryColor}26`,
          borderColor: `${t.primaryColor}59`,
          color: t.accentColor,
        }}
      >
        ▲
      </div>
      <p className="text-[10px] font-semibold mb-1" style={{ color: `${t.accentColor}CC` }}>
        SUA LOGO AQUI
      </p>
      <p className="text-xs font-bold mb-3" style={{ color: t.textColor }}>
        Bem-vindo! Vamos começar?
      </p>
      <div className="h-1.5 rounded mb-1.5 w-full" style={{ backgroundColor: `${t.textColor}1A` }} />
      <div className="h-1.5 rounded mb-3 w-2/3" style={{ backgroundColor: `${t.textColor}1A` }} />
      <div
        className="px-3 py-1.5 rounded-lg text-center text-[11px] font-bold text-white"
        style={{ backgroundColor: t.primaryColor }}
      >
        Começar
      </div>
      <p className="mt-2 text-center text-[9px]" style={{ color: `${t.textColor}80` }}>
        tema {t.name.toLowerCase()}
      </p>
    </div>
  )
}

export function ThemeCarousel({ variant }: { variant: 'dark' | 'light' }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const nudgeRef = useRef<(dir: number) => void>(() => {})

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let setW = track.scrollWidth / 3
    let pos = setW
    track.scrollLeft = pos

    let hoverPause = false
    let touchPause = false
    let anim: { from: number; to: number; t0: number; dur: number } | null = null
    let lastT: number | null = null
    let raf = 0
    let touchTimer: ReturnType<typeof setTimeout> | undefined

    const cardStep = () => {
      const c = track.firstElementChild as HTMLElement | null
      return c ? c.getBoundingClientRect().width + GAP : track.clientWidth * 0.8
    }
    const wrap = () => {
      if (pos < setW * 0.5) pos += setW
      else if (pos >= setW * 1.5) pos -= setW
    }
    const frame = (t: number) => {
      if (lastT === null) lastT = t
      const dt = (t - lastT) / 1000
      lastT = t
      if (Math.abs(track.scrollLeft - pos) > 1) pos = track.scrollLeft // adota swipe manual
      if (anim) {
        const k = Math.min(1, (t - anim.t0) / anim.dur)
        pos = anim.from + (anim.to - anim.from) * (1 - Math.pow(1 - k, 3))
        if (k >= 1) anim = null
      } else if (!reduce && !hoverPause && !touchPause) {
        pos += SPEED * dt
      }
      wrap()
      track.scrollLeft = pos
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    nudgeRef.current = (dir: number) => {
      anim = { from: pos, to: pos + dir * cardStep(), t0: performance.now(), dur: reduce ? 1 : 380 }
    }

    const onEnter = () => { hoverPause = true }
    const onLeave = () => { hoverPause = false }
    const onTouchStart = () => { touchPause = true; clearTimeout(touchTimer) }
    const onTouchEnd = () => {
      clearTimeout(touchTimer)
      touchTimer = setTimeout(() => { touchPause = false }, 2200)
    }
    const onResize = () => { setW = track.scrollWidth / 3 }

    track.addEventListener('mouseenter', onEnter)
    track.addEventListener('mouseleave', onLeave)
    track.addEventListener('touchstart', onTouchStart, { passive: true })
    track.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(touchTimer)
      track.removeEventListener('mouseenter', onEnter)
      track.removeEventListener('mouseleave', onLeave)
      track.removeEventListener('touchstart', onTouchStart)
      track.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const btnClass =
    variant === 'dark'
      ? 'bg-slate-900 border border-white/15 text-slate-200 hover:text-white hover:border-white/30'
      : 'bg-white border border-slate-200 text-slate-600 shadow-sm hover:text-slate-900 hover:border-slate-300'

  return (
    <div className="relative" role="region" aria-label="Exemplos dos temas de formulário">
      <div
        ref={trackRef}
        className="flex gap-3.5 overflow-x-auto py-1 scrollbar-none"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 7%, black 93%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 7%, black 93%, transparent)',
        }}
      >
        {[0, 1, 2].map((set) =>
          themeList.map((t) => <ThemeCard key={`${set}-${t.id}`} t={t} variant={variant} />)
        )}
      </div>

      <button
        type="button"
        aria-label="Tema anterior"
        onClick={() => nudgeRef.current(-1)}
        className={`absolute -left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${btnClass}`}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        aria-label="Próximo tema"
        onClick={() => nudgeRef.current(1)}
        className={`absolute -right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${btnClass}`}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}
