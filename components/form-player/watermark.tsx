import Link from 'next/link'
import Image from 'next/image'
import React from 'react'

interface WatermarkProps {
  plan?: 'free' | 'starter' | 'plus' | 'professional'
}

export const EidosFormWatermark = React.memo(function EidosFormWatermark({ plan = 'free' }: WatermarkProps) {
  // Só mostra para free e starter
  if (plan === 'plus' || plan === 'professional') return null

  return (
    <div className="flex items-center justify-center py-4 mt-6 border-t border-gray-100">
      <Link
        href="https://eidosform.com.br"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors group"
      >
        {/* P2-05 FIX: Use Next.js Image for SVG watermark icon */}
        <Image
          src="/logo-icon-only.svg"
          alt="EidosForm"
          width={16}
          height={16}
          className="opacity-80 group-hover:opacity-100 transition-opacity object-contain"
        />
        <span>
          Criado com{' '}
          <span className="font-medium text-gray-700 group-hover:text-gray-900">EidosForm</span>
        </span>
      </Link>
    </div>
  )
})
