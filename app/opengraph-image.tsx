import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'EidosForm — Formulários inteligentes para o mercado brasileiro'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '800px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(245,183,49,0.15) 0%, transparent 70%)',
          }}
        />

        {/* Brand name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          {/* Logo icon */}
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #F5B731, #E8923A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 900,
              color: '#000',
            }}
          >
            E
          </div>
          <span
            style={{
              fontSize: '64px',
              fontWeight: 900,
              color: '#ffffff',
              letterSpacing: '-2px',
            }}
          >
            EidosForm
          </span>
        </div>

        {/* Tagline */}
        <p
          style={{
            fontSize: '28px',
            color: '#94a3b8',
            textAlign: 'center',
            margin: '0 0 48px',
            maxWidth: '700px',
            lineHeight: 1.3,
          }}
        >
          Formulários inteligentes para o mercado brasileiro
        </p>

        {/* Feature pills */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {['Meta Pixel', 'LGPD', 'CPF/CNPJ', 'BRL'].map((label) => (
            <div
              key={label}
              style={{
                padding: '10px 20px',
                borderRadius: '100px',
                border: '1px solid rgba(245,183,49,0.3)',
                background: 'rgba(245,183,49,0.1)',
                color: '#F5B731',
                fontSize: '18px',
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Bottom URL hint */}
        <p
          style={{
            position: 'absolute',
            bottom: '32px',
            fontSize: '16px',
            color: '#475569',
          }}
        >
          eidosform.com.br
        </p>
      </div>
    ),
    {
      ...size,
    }
  )
}
