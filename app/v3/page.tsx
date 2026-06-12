import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  Crosshair,
  GitBranch,
  Globe,
  KeyRound,
  LineChart,
  Mail,
  Palette,
  Share2,
  Target,
  UserRound,
  Webhook,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MobileMenu } from '@/components/mobile-menu'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { HeroDemo } from '@/components/v3/hero-demo'
import { TestimonialsSection } from '@/components/v3/testimonials-section'
import { PricingSectionV3 } from '@/components/v3/pricing-section-v3'

// Página em homologação (modelada na yayforms.com/br/typeform-alternative):
// noindex até ser aprovada e promovida à raiz. Todos os claims foram
// verificados no código em 2026-06-12 (UTMs: lib/utm-tracker.ts; conversões
// por resposta: evaluatePixelEvents no form-player; sem QR/campos ocultos/
// server-side — não anunciar).
export const metadata: Metadata = {
  title: 'EidosForm — Formulários que as pessoas respondem até o fim',
  description:
    'A alternativa brasileira ao Typeform para tráfego pago: Meta Pixel, Google Ads, GTM e TikTok nativos, conversões por resposta e UTMs em cada lead. Pague em real.',
  robots: { index: false, follow: false },
}

const MIGRATION_EMAIL =
  'mailto:suporte@eidosform.com.br?subject=Migra%C3%A7%C3%A3o%20do%20Typeform&body=Ol%C3%A1!%20Quero%20migrar%20meus%20formul%C3%A1rios%20para%20o%20EidosForm.%20Seguem%20os%20links%3A'

const DIFFERENTIALS = [
  { icon: Target, text: 'Meta Pixel, Google Ads, GTM e TikTok nativos no Plus' },
  { icon: Crosshair, text: 'Conversões personalizadas disparadas pela resposta' },
  { icon: LineChart, text: 'UTMs gravadas em cada lead, com janela de 30 dias' },
  { icon: BadgeCheck, text: 'CPF, CNPJ e CEP validados nativamente' },
  { icon: Globe, text: 'Pague em real — sem dólar, sem IOF' },
  { icon: UserRound, text: 'Suporte humano em português' },
]

const TRAFFIC_FEATURES = [
  {
    icon: Target,
    color: 'from-[#F5B731] to-[#E8923A]',
    title: 'Pixels nativos, sem gambiarra',
    desc: 'Meta Pixel, Google Ads, GTM e TikTok configurados em cliques. Evento no início e na conclusão do formulário, direto no seu gerenciador de anúncios.',
  },
  {
    icon: Crosshair,
    color: 'from-pink-500 to-rose-500',
    title: 'Conversão por resposta',
    desc: 'Dispare um evento diferente conforme o que a pessoa respondeu. Seu pixel aprende quem é lead qualificado — e a campanha otimiza para quem compra, não para quem clica.',
  },
  {
    icon: LineChart,
    color: 'from-blue-500 to-cyan-500',
    title: 'UTMs em cada lead',
    desc: 'Origem, campanha e termo gravados com cada resposta — até as parciais — com janela de atribuição de 30 dias. Exporta tudo no CSV e fecha o ROI por campanha.',
  },
  {
    icon: BarChart3,
    color: 'from-emerald-400 to-teal-500',
    title: 'Abandono por pergunta',
    desc: 'Veja a pergunta exata onde o lead desiste. E com respostas parciais, o que ele digitou antes de sair já está salvo — o clique que você pagou não vira lead perdido.',
  },
]

const EMPHASIS_SECTIONS = [
  {
    id: 'segmentacao',
    badge: 'Segmentação',
    icon: GitBranch,
    color: 'from-violet-500 to-purple-600',
    title: 'Segmente sua audiência com lógica condicional',
    desc: 'Se a resposta for X, pergunte Y. Monte quizzes que separam o curioso do comprador, personalize o caminho de cada pessoa e qualifique o lead antes mesmo de falar com ele.',
    bullets: [
      'Caminhos diferentes conforme a resposta',
      'Quiz de qualificação para high-ticket',
      'Tela de agradecimento personalizada por perfil',
    ],
  },
  {
    id: 'marca',
    badge: 'Sua marca',
    icon: Palette,
    color: 'from-[#F5B731] to-[#E8923A]',
    title: 'Formulário com a cara da sua marca',
    desc: 'Temas, fontes, cores e logo — o formulário parece feito sob medida, porque é. No Plus a marca EidosForm some; no Professional ele vive no seu próprio domínio.',
    bullets: [
      'Temas, cores, fontes e logo personalizados',
      "Sem marca d'água a partir do Plus",
      'Domínio próprio no Professional (formularios.suamarca.com.br)',
    ],
  },
  {
    id: 'compartilhe',
    badge: 'Compartilhe',
    icon: Share2,
    color: 'from-blue-500 to-cyan-500',
    title: 'Publique onde o seu público está',
    desc: 'Link direto pronto para anúncio, bio ou WhatsApp — ou incorpore o formulário dentro do seu site. Ao final, redirecione para a página de obrigado que o seu funil precisa.',
    bullets: [
      'Link direto, pronto para campanha',
      'Embed no seu site ou landing page',
      'Redirecionamento pós-envio configurável',
    ],
  },
]

const INTEGRATIONS = [
  { name: 'Meta Pixel', hue: 'bg-blue-500/15 text-blue-300 border-blue-400/20' },
  { name: 'Google Ads', hue: 'bg-yellow-500/15 text-yellow-300 border-yellow-400/20' },
  { name: 'Google Tag Manager', hue: 'bg-sky-500/15 text-sky-300 border-sky-400/20' },
  { name: 'TikTok Pixel', hue: 'bg-rose-500/15 text-rose-300 border-rose-400/20' },
  { name: 'Google Sheets', hue: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20' },
  { name: 'Calendly', hue: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/20' },
  { name: 'WhatsApp', hue: 'bg-green-500/15 text-green-300 border-green-400/20' },
  { name: 'Email', hue: 'bg-slate-500/15 text-slate-300 border-slate-400/20' },
  { name: 'Webhooks', hue: 'bg-violet-500/15 text-violet-300 border-violet-400/20' },
  { name: 'Make*', hue: 'bg-purple-500/15 text-purple-300 border-purple-400/20' },
  { name: 'Zapier*', hue: 'bg-orange-500/15 text-orange-300 border-orange-400/20' },
  { name: 'n8n*', hue: 'bg-pink-500/15 text-pink-300 border-pink-400/20' },
]

const AGENCY_BULLETS = [
  'Cada formulário com a marca do cliente: logo, cores e tema próprios',
  'Domínio personalizado — o formulário vive no endereço do cliente',
  'Webhooks entregando leads direto no CRM de cada cliente',
  'API v1 com chave dedicada para automatizar a operação',
  '15.000 respostas/mês e suporte com SLA',
]

// Preços do Typeform verificados em typeform.com/pricing (jun/2026, cobrança
// anual). Conversão conservadora a R$5,00/US$ — com câmbio real + IOF fica
// mais caro que o mostrado.
const FINANCIAL_COMPARISON = [
  {
    tier: 'Entrada',
    eidos: { plan: 'Starter', price: 'R$29/mês', responses: '1.000 respostas' },
    typeform: { plan: 'Basic', price: 'US$25 (~R$125/mês)', responses: '100 respostas' },
    ratio: '43× mais respostas por real',
  },
  {
    tier: 'Intermediário',
    eidos: { plan: 'Plus', price: 'R$97/mês', responses: '5.000 respostas' },
    typeform: { plan: 'Plus', price: 'US$50 (~R$250/mês)', responses: '1.000 respostas' },
    ratio: '13× mais respostas por real',
  },
  {
    tier: 'Escala',
    eidos: { plan: 'Professional', price: 'R$197/mês', responses: '15.000 respostas' },
    typeform: { plan: 'Business', price: 'US$83 (~R$415/mês)', responses: '10.000 respostas' },
    ratio: '3× mais respostas por real',
  },
]

const FEATURE_COMPARISON: Array<{ label: string; eidos: string | boolean; typeform: string | boolean }> = [
  { label: 'Cobrança em real, sem IOF', eidos: true, typeform: false },
  { label: 'Respostas no plano de entrada', eidos: '1.000/mês por R$29', typeform: '100/mês por US$25' },
  { label: 'Validação de CPF e CNPJ', eidos: true, typeform: false },
  { label: 'Endereço automático por CEP', eidos: true, typeform: false },
  { label: 'Conversão de pixel disparada pela resposta', eidos: true, typeform: false },
  { label: 'TikTok Pixel nativo', eidos: true, typeform: false },
  { label: 'Taxa de abandono por pergunta', eidos: 'No Plus (R$97)', typeform: 'Só em planos altos' },
  { label: 'Respostas parciais', eidos: 'No Plus (R$97)', typeform: 'Só em planos altos' },
  { label: 'Suporte humano em português', eidos: true, typeform: false },
  { label: 'Integração nativa com Salesforce', eidos: false, typeform: true },
  { label: 'Pagamentos embutidos (Stripe)', eidos: false, typeform: true },
  { label: 'Certificações SOC 2 / HIPAA', eidos: false, typeform: true },
]

const FAQS = [
  {
    q: 'Estou no Typeform. Como migro para o EidosForm?',
    a: 'A gente migra para você, sem custo: envie um email para suporte@eidosform.com.br com os links dos seus formulários e nosso time recria tudo no EidosForm. Você só revisa e publica.',
  },
  {
    q: 'O que o Typeform tem que vocês não têm?',
    a: 'Integração nativa com Salesforce, campos de pagamento embutidos (Stripe) e certificações SOC 2/HIPAA. Se a sua operação exige isso, o Typeform é a escolha certa. Para captar e qualificar leads no Brasil com tráfego pago, o EidosForm entrega mais — por bem menos.',
  },
  {
    q: 'O EidosForm é realmente gratuito?',
    a: 'Sim! O plano Free é grátis para sempre, sem limite de tempo e sem precisar de cartão de crédito. Você cria até 3 formulários e coleta até 100 respostas por mês.',
  },
  {
    q: 'Como funcionam as conversões por resposta?',
    a: 'Em cada pergunta você pode configurar regras: se a pessoa responder X, o formulário dispara um evento personalizado no seu Meta Pixel, Google Ads, GTM ou TikTok. Assim a campanha otimiza para o lead qualificado, não para qualquer clique.',
  },
  {
    q: 'As UTMs das minhas campanhas são salvas?',
    a: 'Sim. Origem, mídia, campanha, termo e conteúdo (utm_source, utm_medium, utm_campaign, utm_term, utm_content) são capturados na chegada e gravados junto de cada resposta — inclusive as parciais — com janela de atribuição de 30 dias. Tudo sai na exportação CSV.',
  },
  {
    q: 'O que acontece quando atinjo o limite de respostas do mês?',
    a: 'Seu formulário para de receber novas respostas até a virada do ciclo mensal — nunca cobramos nada a mais automaticamente. Você pode fazer upgrade a qualquer momento e a cota nova vale na hora. Nos planos Plus e Professional, avisamos por email quando você usa 80% do limite.',
  },
  {
    q: 'Quais formas de pagamento vocês aceitam?',
    a: 'Cartão de crédito, com cobrança em reais — sem IOF e sem variação de câmbio. Você escolhe entre assinatura mensal ou anual (com até 41% de desconto).',
  },
  {
    q: 'Posso cancelar minha assinatura quando quiser?',
    a: 'Sim, sem burocracia. Você cancela pelo painel de configurações e o acesso ao plano pago continua até o fim do período já pago. Não há multas ou taxas de cancelamento.',
  },
  {
    q: 'Posso usar meu próprio domínio?',
    a: 'Sim, com o plano Professional você pode configurar um domínio personalizado. Basta adicionar um registro CNAME no seu provedor de DNS e seus formulários ficam acessíveis no seu próprio endereço — ou no do seu cliente.',
  },
  {
    q: 'Os dados das respostas ficam seguros?',
    a: 'Totalmente. Todos os dados são criptografados em trânsito (TLS 1.3) e em repouso (AES-256). Seguimos a LGPD e você pode exportar ou deletar todos os dados a qualquer momento.',
  },
]

function ComparisonCell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <span className="w-7 h-7 rounded-full bg-[#4BB678]/15 flex items-center justify-center mx-auto">
        <Check className="w-4 h-4 text-[#4BB678]" />
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center mx-auto">
        <X className="w-4 h-4 text-slate-600" />
      </span>
    )
  }
  return <span className="text-xs sm:text-sm text-slate-300 block text-center leading-snug">{value}</span>
}

export default function LandingV3Page() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <EidosLogo variant="reduced" theme="dark" href="/v3" height={34} />
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#trafego-pago" className="hover:text-white transition-colors">Tráfego pago</a>
            <a href="#agencias" className="hover:text-white transition-colors">Agências</a>
            <a href="#comparativo" className="hover:text-white transition-colors">vs Typeform</a>
            <a href="#precos" className="hover:text-white transition-colors">Preços</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-white/10">
                  Entrar
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-semibold shadow-lg shadow-[#F5B731]/20 transition-all hover:shadow-[#E8923A]/30">
                  Criar conta grátis
                </Button>
              </Link>
            </div>
            <MobileMenu />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 sm:pt-32 pb-12 sm:pb-16 px-4 sm:px-6 relative">
        <div className="absolute top-20 left-1/4 w-[300px] sm:w-[500px] h-[400px] bg-[#F5B731]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-10 items-center relative">
          <div className="text-center lg:text-left">
            <Badge className="mb-6 bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20 px-3 py-1.5 text-sm font-medium max-w-fit mx-auto lg:mx-0">
              🇧🇷 A alternativa brasileira ao Typeform
            </Badge>

            <h1 className="text-[30px] sm:text-4xl md:text-5xl xl:text-6xl font-black tracking-tight mb-5 leading-[1.05]">
              Formulários que as pessoas
              <span className="block bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
                respondem até o fim
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-slate-400 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Feito para tráfego pago: Meta Pixel, Google Ads, GTM e TikTok nativos,
              conversões disparadas pela resposta e UTMs gravadas em cada lead.
              Em real, sem IOF.
            </p>

            <div className="flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
                  Criar conta grátis
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <a href="#comparativo">
                <Button variant="ghost" size="lg" className="w-full sm:w-auto border border-white/30 text-slate-200 hover:bg-white/10 hover:text-white hover:border-white/50 px-8 py-6 text-base rounded-xl">
                  Comparar com Typeform
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </div>

            <p className="mt-6 text-sm text-slate-400">
              Grátis para sempre até 100 respostas/mês · Sem cartão de crédito
            </p>
          </div>

          <HeroDemo />
        </div>
      </section>

      {/* Faixa de diferenciais */}
      <section className="py-10 px-4 sm:px-6 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-3">
          {DIFFERENTIALS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="w-8 h-8 min-w-8 rounded-lg bg-[#F5B731]/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#F5B731]" />
              </span>
              <p className="text-xs sm:text-sm text-slate-300 leading-snug">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Migração */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-3xl border border-[#F5B731]/20 bg-gradient-to-br from-[#F5B731]/[0.08] to-transparent p-8 sm:p-12 text-center">
            <span className="inline-flex w-12 h-12 rounded-2xl bg-[#F5B731]/15 items-center justify-center mb-5">
              <ArrowRightLeft className="w-6 h-6 text-[#F5B731]" />
            </span>
            <h2 className="text-2xl sm:text-4xl font-black mb-3">
              Saindo do Typeform? <span className="text-[#F5B731]">A gente migra para você.</span>
            </h2>
            <p className="text-slate-400 text-lg mb-7 max-w-2xl mx-auto">
              Envie os links dos seus formulários e nosso time recria tudo no EidosForm,
              sem custo. Você só revisa, publica e troca o link.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <a href={MIGRATION_EMAIL}>
                <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold px-8 py-6 shadow-xl shadow-[#F5B731]/25">
                  <Mail className="w-4 h-4 mr-2" />
                  Pedir migração gratuita
                </Button>
              </a>
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-[#4BB678]" /> Sem custo</span>
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-[#4BB678]" /> Sem downtime</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tráfego pago */}
      <section id="trafego-pago" className="py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Tráfego pago</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Pixel pronto. <span className="text-[#F5B731]">CPL sob controle.</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Cada real investido em anúncio precisa virar lead rastreável.
              O EidosForm foi desenhado para isso.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            {TRAFFIC_FEATURES.map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="group p-7 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all duration-300 hover:-translate-y-0.5">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Seções de ênfase: segmentação, marca, compartilhamento */}
      {EMPHASIS_SECTIONS.map(({ id, badge, icon: Icon, color, title, desc, bullets }, idx) => (
        <section key={id} id={id} className={`py-20 px-4 sm:px-6 ${idx % 2 ? 'bg-white/[0.02]' : ''}`}>
          <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_1.2fr] gap-10 items-center">
            <div className={idx % 2 ? 'md:order-2' : ''}>
              <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">{badge}</Badge>
              <h2 className="text-2xl sm:text-4xl font-black mb-4 leading-tight">{title}</h2>
              <p className="text-slate-400 leading-relaxed">{desc}</p>
            </div>
            <div className={`p-7 rounded-2xl bg-white/[0.04] border border-white/5 ${idx % 2 ? 'md:order-1' : ''}`}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-5 shadow-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <ul className="space-y-3">
                {bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm sm:text-base text-slate-300 leading-relaxed">
                    <Check className="w-4 h-4 text-[#4BB678] mt-1 flex-shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}

      {/* Integrações */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto text-center">
          <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Integrações</Badge>
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Conecte com o que você <span className="text-[#F5B731]">já usa</span>
          </h2>
          <p className="text-slate-400 text-lg mb-10 max-w-2xl mx-auto">
            Cada resposta vai para a sua planilha, seu CRM ou sua automação —
            por integração nativa ou webhook em tempo real.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            {INTEGRATIONS.map(({ name, hue }) => (
              <span
                key={name}
                className={`px-4 py-2.5 rounded-xl border text-sm font-semibold ${hue}`}
              >
                {name}
              </span>
            ))}
          </div>
          <p className="mt-6 text-xs text-slate-600">* via webhook em tempo real</p>
        </div>
      </section>

      {/* Agências → Professional */}
      <section id="agencias" className="py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <div>
            <Badge className="mb-4 bg-violet-500/10 text-violet-300 border border-violet-400/20">
              <Building2 className="w-3.5 h-3.5 mr-1.5" />
              Para agências
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-black mb-4 leading-tight">
              Um formulário com a marca de <span className="text-violet-300">cada cliente</span>
            </h2>
            <p className="text-slate-400 leading-relaxed mb-6">
              Entregue para o seu cliente um formulário que parece feito pela equipe dele:
              identidade visual própria, domínio próprio e leads caindo direto no CRM dele.
              Tudo numa conta só, no plano Professional.
            </p>
            <Link href="/register?next=/checkout/professional&cycle=yearly">
              <Button size="lg" className="bg-violet-500 hover:bg-violet-400 text-white font-bold px-8 shadow-xl shadow-violet-500/25">
                Assinar Professional
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <p className="mt-3 text-sm text-slate-500">R$197/mês no plano anual · 15.000 respostas/mês</p>
          </div>
          <div className="p-7 rounded-2xl bg-slate-900 border border-violet-400/20 ring-1 ring-violet-400/10">
            <ul className="space-y-4">
              {AGENCY_BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm sm:text-base text-slate-300 leading-relaxed">
                  <span className="w-6 h-6 min-w-6 rounded-lg bg-violet-500/15 flex items-center justify-center mt-0.5">
                    <Check className="w-3.5 h-3.5 text-violet-300" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-5 border-t border-white/5 flex items-center gap-3 text-xs text-slate-500">
              <KeyRound className="w-4 h-4 text-violet-300" />
              API v1 + webhooks <Webhook className="w-4 h-4 text-violet-300 ml-2" /> para plugar no stack da agência
            </div>
          </div>
        </div>
      </section>

      {/* Depoimentos */}
      <TestimonialsSection />

      {/* Comparativo vs Typeform */}
      <section id="comparativo" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">EidosForm vs Typeform</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Mais respostas. <span className="text-[#F5B731]">Menos dólar.</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Compare plano a plano: no EidosForm, o mesmo orçamento compra muito mais resposta —
              e em real, sem IOF.
            </p>
          </div>

          {/* Financeiro plano a plano */}
          <div className="grid sm:grid-cols-3 gap-5 mb-16">
            {FINANCIAL_COMPARISON.map(({ tier, eidos, typeform, ratio }) => (
              <div key={tier} className="p-6 rounded-2xl bg-white/[0.04] border border-white/5 flex flex-col">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{tier}</p>

                <div className="mb-4 pb-4 border-b border-white/5">
                  <p className="text-sm font-bold text-[#F5B731] mb-1">EidosForm {eidos.plan}</p>
                  <p className="text-2xl font-black text-white">{eidos.responses}</p>
                  <p className="text-sm text-slate-400">{eidos.price}</p>
                </div>

                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-500 mb-1">Typeform {typeform.plan}</p>
                  <p className="text-lg font-bold text-slate-400">{typeform.responses}</p>
                  <p className="text-sm text-slate-500">{typeform.price}</p>
                </div>

                <span className="mt-auto inline-flex self-start px-3 py-1.5 rounded-full bg-[#4BB678]/15 text-[#4BB678] text-xs font-bold">
                  {ratio}
                </span>
              </div>
            ))}
          </div>

          {/* Tabela de recursos */}
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-slate-900 border-b border-white/10 text-xs sm:text-sm font-bold">
              <div className="px-4 sm:px-6 py-4 text-slate-400 uppercase tracking-wider text-xs">Recurso</div>
              <div className="px-2 sm:px-4 py-4 text-[#F5B731] text-center">EidosForm</div>
              <div className="px-2 sm:px-4 py-4 text-slate-500 text-center">Typeform</div>
            </div>
            {FEATURE_COMPARISON.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-[1.4fr_1fr_1fr] items-center text-sm ${
                  i % 2 ? 'bg-white/[0.02]' : ''
                } ${i < FEATURE_COMPARISON.length - 1 ? 'border-b border-white/5' : ''}`}
              >
                <div className="px-4 sm:px-6 py-4 text-slate-300 leading-snug">{row.label}</div>
                <div className="px-2 sm:px-4 py-4"><ComparisonCell value={row.eidos} /></div>
                <div className="px-2 sm:px-4 py-4"><ComparisonCell value={row.typeform} /></div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-600 text-center">
            Preços do Typeform conforme typeform.com/pricing em junho/2026 (cobrança anual),
            convertidos a R$5,00/US$ — com câmbio do dia e IOF, a diferença é ainda maior.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <PricingSectionV3 />

      {/* FAQ */}
      <section id="faq" className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">FAQ</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">Dúvidas frequentes</h2>
          </div>

          <div className="space-y-4">
            {FAQS.map(({ q, a }, i) => (
              <details key={i} className="group p-5 rounded-2xl bg-white/[0.04] border border-white/5 hover:border-white/10 transition-all cursor-pointer">
                <summary className="flex items-center justify-between font-semibold text-white text-sm sm:text-base list-none min-h-[44px]">
                  {q}
                  <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-4" />
                </summary>
                <p className="mt-4 text-sm text-slate-400 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-24 px-4 sm:px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#F5B731]/3 to-transparent pointer-events-none" />
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Seu próximo lead está a um formulário de distância
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Crie o primeiro grátis, em minutos. Se as pessoas responderem mais, você fica.
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-lg px-10 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
              Criar conta grátis
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="mt-4 text-sm text-slate-500">Grátis até 100 respostas/mês · Sem cartão de crédito</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="mb-4 max-w-full">
                <EidosLogo variant="full" theme="dark" href="/v3" height={67} />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Formulários conversacionais que as pessoas respondem até o fim.
                Feito no Brasil, em real.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Produto</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#trafego-pago" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Tráfego pago</a></li>
                <li><a href="#comparativo" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">vs Typeform</a></li>
                <li><a href="#precos" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Preços</a></li>
                <li><Link href="/login" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Painel</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Suporte</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#faq" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">FAQ</a></li>
                <li><a href="mailto:suporte@eidosform.com.br" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Contato</a></li>
                <li><a href={MIGRATION_EMAIL} className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Migração do Typeform</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Legal</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><Link href="/privacidade" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Privacidade</Link></li>
                <li><Link href="/termos" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Termos de uso</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-600">© 2026 EidosForm. Todos os direitos reservados.</p>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Feito com</span>
              <span className="text-[#F5B731]">♥</span>
              <span>pela Eidos</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
