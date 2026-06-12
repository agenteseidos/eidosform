import { ArrowDown, ArrowRight, Check, Globe, ImageIcon, Link2, Lock, Target } from 'lucide-react'

// Mockups codados das seções de ênfase da /v3 — mini-interfaces ilustrativas
// no estilo da demo do hero (HTML/CSS, sem assets externos). São decorativos:
// representam o produto sem serem screenshots, então não desatualizam.

/** Segmentação: pergunta com duas ramificações e evento de pixel no caminho premium */
export function MockupSegmentation() {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6 select-none" aria-hidden>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 mb-4">
        <p className="text-[10px] font-semibold text-[#F5B731] mb-1">PERGUNTA 3</p>
        <p className="text-sm font-bold text-white">Qual seu orçamento mensal de tráfego?</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Ramo 1 */}
        <div className="flex flex-col items-center">
          <div className="w-full px-3 py-2 rounded-lg border border-white/15 bg-white/[0.03] text-xs text-slate-300 text-center">
            Até R$1.000
          </div>
          <ArrowDown className="w-4 h-4 text-slate-600 my-2" />
          <div className="w-full px-3 py-2.5 rounded-lg border border-blue-400/30 bg-blue-500/10 text-center">
            <p className="text-[10px] text-blue-300 font-semibold">→ PERGUNTA 4</p>
            <p className="text-xs text-slate-300 mt-0.5">Receber guia gratuito</p>
          </div>
        </div>

        {/* Ramo 2 */}
        <div className="flex flex-col items-center">
          <div className="w-full px-3 py-2 rounded-lg border border-[#F5B731]/40 bg-[#F5B731]/10 text-xs text-[#F5B731] font-semibold text-center">
            Acima de R$5.000
          </div>
          <ArrowDown className="w-4 h-4 text-[#F5B731]/60 my-2" />
          <div className="w-full px-3 py-2.5 rounded-lg border border-[#4BB678]/30 bg-[#4BB678]/10 text-center">
            <p className="text-[10px] text-[#4BB678] font-semibold">→ TELA FINAL VIP</p>
            <p className="text-xs text-slate-300 mt-0.5">Agendar call com especialista</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-400/20">
        <Target className="w-3.5 h-3.5 text-pink-300 flex-shrink-0" />
        <p className="text-[11px] text-pink-200">
          Pixel: evento <span className="font-mono font-bold">lead_qualificado</span> disparado no ramo premium
        </p>
      </div>
    </div>
  )
}

/** Marca: o mesmo formulário em 2 dos 7 temas, com a logo do cliente na abertura */
export function MockupBrand() {
  return (
    <div className="select-none" aria-hidden>
      <div className="grid grid-cols-2 gap-3">
        {/* Tema midnight */}
        <div className="rounded-2xl border border-white/10 bg-[#0f172a] p-4">
          <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center mb-3">
            <ImageIcon className="w-4 h-4 text-blue-300" />
          </div>
          <p className="text-[10px] text-blue-300/70 font-semibold mb-1">SUA LOGO AQUI</p>
          <p className="text-xs font-bold text-white mb-3">Bem-vindo! Vamos começar?</p>
          <div className="h-1.5 rounded bg-white/10 mb-1.5 w-full" />
          <div className="h-1.5 rounded bg-white/10 mb-3 w-2/3" />
          <div className="px-3 py-1.5 rounded-lg bg-blue-500 text-center text-[11px] font-bold text-white">
            Começar
          </div>
          <p className="mt-2 text-center text-[9px] text-slate-500">tema midnight</p>
        </div>

        {/* Tema terracota */}
        <div className="rounded-2xl border border-orange-200/20 bg-[#f5ede4] p-4">
          <div className="w-9 h-9 rounded-full bg-[#b85c38]/15 border border-[#b85c38]/30 flex items-center justify-center mb-3">
            <ImageIcon className="w-4 h-4 text-[#b85c38]" />
          </div>
          <p className="text-[10px] text-[#b85c38]/80 font-semibold mb-1">SUA LOGO AQUI</p>
          <p className="text-xs font-bold text-[#3d2c23] mb-3">Bem-vindo! Vamos começar?</p>
          <div className="h-1.5 rounded bg-[#3d2c23]/10 mb-1.5 w-full" />
          <div className="h-1.5 rounded bg-[#3d2c23]/10 mb-3 w-2/3" />
          <div className="px-3 py-1.5 rounded-lg bg-[#b85c38] text-center text-[11px] font-bold text-white">
            Começar
          </div>
          <p className="mt-2 text-center text-[9px] text-[#3d2c23]/50">tema terracota</p>
        </div>
      </div>

      {/* Paleta dos 7 temas */}
      <div className="mt-4 flex items-center justify-center gap-2">
        {['#3b82f6', '#0ea5e9', '#f97316', '#22c55e', '#a78bfa', '#94a3b8', '#b85c38'].map((c) => (
          <span key={c} className="w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: c }} />
        ))}
        <span className="ml-2 text-[11px] text-slate-500">7 temas profissionais</span>
      </div>
    </div>
  )
}

/** Compartilhe: site do cliente com o formulário embutido + link direto */
export function MockupShare() {
  return (
    <div className="select-none" aria-hidden>
      {/* Janela de browser */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
          <div className="ml-2 flex-1 flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/5 text-[10px] text-slate-400">
            <Lock className="w-2.5 h-2.5" /> suaempresa.com.br
          </div>
        </div>
        <div className="p-4">
          <div className="h-2 rounded bg-white/10 w-1/2 mb-2" />
          <div className="h-1.5 rounded bg-white/5 w-full mb-1" />
          <div className="h-1.5 rounded bg-white/5 w-3/4 mb-3" />
          {/* Form embutido */}
          <div className="rounded-xl border border-[#F5B731]/30 bg-[#0A0A0F] p-3">
            <div className="h-1 rounded-full bg-white/10 mb-3 overflow-hidden">
              <div className="h-full w-2/3 bg-gradient-to-r from-[#F5B731] to-[#E8923A]" />
            </div>
            <p className="text-[10px] text-[#F5B731] font-semibold mb-0.5">2 de 3</p>
            <p className="text-xs font-bold text-white mb-2">Qual é o seu e-mail?</p>
            <div className="h-6 rounded border-b border-white/20 mb-2 flex items-end pb-1">
              <span className="text-[10px] text-slate-600">voce@empresa.com.br</span>
            </div>
            <div className="inline-flex px-3 py-1 rounded-md bg-[#F5B731] text-[10px] font-bold text-black items-center gap-1">
              OK <Check className="w-2.5 h-2.5" />
            </div>
            <p className="mt-1.5 text-[9px] text-slate-600">formulário embutido no seu site</p>
          </div>
        </div>
      </div>

      {/* Link direto */}
      <div className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.04]">
        <Link2 className="w-3.5 h-3.5 text-[#F5B731] flex-shrink-0" />
        <span className="text-[11px] text-slate-300 font-mono truncate">eidosform.com.br/f/seu-formulario</span>
        <span className="ml-auto text-[10px] text-slate-500 whitespace-nowrap">pronto p/ anúncio e bio</span>
      </div>
    </div>
  )
}

/** Agência: domínio do cliente + lead caindo no CRM dele via webhook */
export function MockupAgency() {
  return (
    <div className="select-none" aria-hidden>
      {/* Dois domínios de clientes */}
      <div className="space-y-2 mb-4">
        {['formularios.cliente-a.com.br', 'pesquisa.cliente-b.com'].map((d) => (
          <div key={d} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/20 bg-violet-500/[0.06]">
            <Lock className="w-3 h-3 text-violet-300 flex-shrink-0" />
            <span className="text-[11px] sm:text-xs text-slate-200 font-mono truncate">{d}</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[#4BB678] whitespace-nowrap">
              <Check className="w-3 h-3" /> verificado
            </span>
          </div>
        ))}
      </div>

      {/* Fluxo lead → CRM */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-center">
          <Globe className="w-4 h-4 text-violet-300 mx-auto mb-1.5" />
          <p className="text-[10px] font-bold text-white leading-tight">Lead respondeu</p>
          <p className="text-[9px] text-slate-500 mt-0.5">form do Cliente A</p>
        </div>
        <div className="flex flex-col items-center">
          <ArrowRight className="w-4 h-4 text-violet-300" />
          <span className="text-[8px] text-slate-500 mt-0.5 whitespace-nowrap">webhook</span>
        </div>
        <div className="flex-1 rounded-xl border border-[#4BB678]/25 bg-[#4BB678]/[0.08] p-3 text-center">
          <p className="text-sm mb-0.5">📥</p>
          <p className="text-[10px] font-bold text-white leading-tight">CRM do Cliente A</p>
          <p className="text-[9px] text-[#4BB678] mt-0.5">em tempo real</p>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-500">
        Vários clientes, vários domínios — <span className="text-violet-300 font-semibold">uma conta só</span>
      </p>
    </div>
  )
}
