'use client'

import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const LOGO_MAP = {
  full: {
    dark: { src: '/logo-full-dark.png', width: 1200, height: 400 },
    light: { src: '/logo-full-light.png', width: 1200, height: 400 },
  },
  reduced: {
    dark: { src: '/logo-reduced-dark.png', width: 800, height: 200 },
    light: { src: '/logo-reduced-light.png', width: 800, height: 200 },
  },
  icon: {
    dark: { src: '/logo-icon-only.png', width: 200, height: 200 },
    light: { src: '/logo-icon-only.png', width: 200, height: 200 },
  },
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
  const logo = LOGO_MAP[variant][theme]
  const aspectRatio = logo.width / logo.height
  const computedWidth = Math.round(height * aspectRatio)

  const image = (
    <Image
      src={logo.src}
      alt="EidosForm"
      width={computedWidth}
      height={height}
      className={cn('object-contain', className)}
      priority
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
