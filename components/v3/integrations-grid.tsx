import { Mail, Webhook } from 'lucide-react'
import {
  siCalendly,
  siGoogleads,
  siGooglesheets,
  siGoogletagmanager,
  siMake,
  siMeta,
  siN8n,
  siTiktok,
  siWhatsapp,
  siZapier,
} from 'simple-icons'

// Grade de integrações da /v3 com os logos oficiais (simple-icons, inline SVG).
// Itens com asterisco conectam via webhook em tempo real (não integração nativa).

interface BrandIcon {
  title: string
  path: string
  hex: string
}

// TikTok é preto no guia da marca — invisível no fundo escuro; exibe branco.
const display = (icon: BrandIcon, hexOverride?: string) => ({
  name: icon.title,
  path: icon.path,
  color: `#${hexOverride ?? icon.hex}`,
})

const BRAND_ICONS = [
  display(siMeta),
  display(siGoogleads),
  display(siGoogletagmanager),
  display(siTiktok, 'FFFFFF'),
  display(siGooglesheets),
  display(siCalendly),
  display(siWhatsapp),
  { name: 'Make*', path: siMake.path, color: `#${siMake.hex}` },
  { name: 'Zapier*', path: siZapier.path, color: `#${siZapier.hex}` },
  { name: 'n8n*', path: siN8n.path, color: `#${siN8n.hex}` },
]

function BrandSvg({ path, color }: { path: string; color: string }) {
  return (
    <svg role="img" viewBox="0 0 24 24" className="w-7 h-7" fill={color} aria-hidden>
      <path d={path} />
    </svg>
  )
}

export function IntegrationsGrid() {
  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {BRAND_ICONS.map(({ name, path, color }) => (
          <div
            key={name}
            className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all"
          >
            <BrandSvg path={path} color={color} />
            <span className="text-xs text-slate-400 font-medium text-center leading-tight">{name}</span>
          </div>
        ))}

        {/* Email e Webhooks não têm marca — ícones genéricos */}
        <div className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all">
          <Mail className="w-7 h-7 text-slate-300" />
          <span className="text-xs text-slate-400 font-medium">Email</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all">
          <Webhook className="w-7 h-7 text-violet-300" />
          <span className="text-xs text-slate-400 font-medium">Webhooks</span>
        </div>
      </div>
      <p className="mt-6 text-xs text-slate-600 text-center">* via webhook em tempo real</p>
    </div>
  )
}
