'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

interface LogoProps {
  href?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Logo({ href = '/', size = 'md', className }: LogoProps) {
  const sizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  }

  const content = (
    <span
      className={cn(
        sizes[size],
        'font-bold tracking-tight',
        className
      )}
    >
      <span style={{ color: '#F5B731' }} className="font-bold">Eidos</span>
      <span style={{ color: 'var(--eidos-navy)' }} className="font-extrabold ">Form</span>
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
