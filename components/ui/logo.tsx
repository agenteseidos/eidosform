'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

interface LogoProps {
  href?: string
  size?: 'sm' | 'md' | 'lg'
  /** "dark" = para fundo escuro (Form em branco) | "light" = para fundo claro (Form em navy) */
  theme?: 'dark' | 'light'
  className?: string
}

export function Logo({ href = '/', size = 'md', theme = 'light', className }: LogoProps) {
  const sizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  }

  const formColor = theme === 'dark' ? '#FFFFFF' : 'var(--eidos-navy)'

  const content = (
    <span
      className={cn(
        sizes[size],
        'font-bold tracking-tight',
        className
      )}
    >
      <span style={{ color: '#F5B731' }} className="font-bold">Eidos</span>
      <span style={{ color: formColor }} className="font-extrabold">Form</span>
    </span>
  )

  if (href) {
    return (
      <Link href={href} className="focus:outline-none focus-visible:ring-2 rounded" style={{ '--tw-ring-color': '#F5B731' } as React.CSSProperties}>
        {content}
      </Link>
    )
  }

  return content
}
