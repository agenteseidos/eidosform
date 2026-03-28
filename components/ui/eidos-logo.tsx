'use client'

import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface EidosLogoProps {
  /** "full" = ícone + "EidosForm" + tagline | "reduced" = ícone + "EidosForm" */
  variant?: 'full' | 'reduced'
  /** "dark" = textos brancos (fundo escuro) | "light" = textos azul escuro (fundo claro) */
  theme?: 'dark' | 'light'
  /** Se definido, envolve a logo num Link */
  href?: string
  /** Tamanho do ícone em pixels */
  size?: number
  className?: string
}

export function EidosLogo({
  variant = 'full',
  theme = 'dark',
  href,
  size = 32,
  className,
}: EidosLogoProps) {
  const textColor = theme === 'dark' ? 'text-white' : 'text-[#1E3A5F]'
  const taglineColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500'

  // Proporção do texto relativa ao ícone
  const titleSize = size >= 40 ? 'text-2xl' : size >= 32 ? 'text-xl' : 'text-lg'
  const taglineSize = size >= 40 ? 'text-sm' : 'text-xs'

  const content = (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Image
        src="/logo-eidosform.png"
        alt="EidosForm"
        width={size}
        height={size}
        className="flex-shrink-0 object-contain"
        priority
      />
      <div className="flex flex-col">
        <span className={cn(titleSize, 'font-bold tracking-tight leading-tight', textColor)}>
          <span style={{ color: '#F5B731' }}>Eidos</span>
          <span className={theme === 'dark' ? 'text-white' : ''} style={theme === 'light' ? { color: '#1E3A5F' } : undefined}>Form</span>
        </span>
        {variant === 'full' && (
          <span className={cn(taglineSize, 'leading-tight', taglineColor)}>
            Formulários que convertem
          </span>
        )}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="focus:outline-none focus-visible:ring-2 rounded inline-flex"
        style={{ '--tw-ring-color': '#F5B731' } as React.CSSProperties}
      >
        {content}
      </Link>
    )
  }

  return content
}
