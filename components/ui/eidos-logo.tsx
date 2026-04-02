'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

const LOGO_MAP = {
  full: {
    dark: '/logo-full-dark.svg',
    light: '/logo-full-light.svg',
  },
  reduced: {
    dark: '/logo-reduced-dark.svg',
    light: '/logo-reduced-light.svg',
  },
  icon: {
    dark: '/logo-icon-only.svg',
    light: '/logo-icon-only.svg',
  },
} as const

/** Aspect ratios por variante (largura / altura) */
const ASPECT_RATIOS = {
  full: 5.05, // 212/42
  reduced: 4, // ~800/200
  icon: 1, // quadrado
} as const

export interface EidosLogoProps {
  /** "full" = logo + tagline | "reduced" = logo sem tagline | "icon" = só ícone */
  variant?: 'full' | 'reduced' | 'icon'
  /** "dark" = para fundo escuro | "light" = para fundo claro */
  theme?: 'dark' | 'light'
  /** Se definido, envolve a logo num Link */
  href?: string
  /** Altura da logo em pixels (largura calculada proporcionalmente) */
  height?: number
  className?: string
}

export function EidosLogo({
  variant = 'full',
  theme = 'dark',
  href,
  height = 40,
  className,
}: EidosLogoProps) {
  const src = LOGO_MAP[variant][theme]
  const aspectRatio = ASPECT_RATIOS[variant]
  const computedWidth = Math.round(height * aspectRatio)

  const image = (
    <img
      src={src}
      alt="EidosForm"
      width={computedWidth}
      height={height}
      className={cn('object-contain', className)}
    />
  )

  if (href) {
    return (
      <Link
        href={href}
        className="focus:outline-none focus-visible:ring-2 rounded inline-flex"
        style={{ '--tw-ring-color': '#F5B731' } as React.CSSProperties}
      >
        {image}
      </Link>
    )
  }

  return image
}
