import Link from 'next/link'

interface WatermarkProps {
  plan?: 'free' | 'starter' | 'plus' | 'professional'
}

export function EidosFormWatermark({ plan = 'free' }: WatermarkProps) {
  // Só mostra para free e starter
  if (plan === 'plus' || plan === 'professional') return null

  return (
    <div className="flex items-center justify-center py-4 mt-6 border-t border-gray-100">
      <Link
        href="https://eidosform.com.br"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors group"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          className="opacity-60 group-hover:opacity-100 transition-opacity"
        >
          <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
          <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.5" />
          <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.5" />
          <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.25" />
        </svg>
        <span>
          Criado com{' '}
          <span className="font-medium text-gray-500 group-hover:text-gray-700">EidosForm</span>
        </span>
      </Link>
    </div>
  )
}
