import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronDown,
  Crosshair,
  GitBranch,
  Megaphone,
  Rocket,
  Shield,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MobileMenu } from '@/components/mobile-menu'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { HeroDemo } from '@/components/v2/hero-demo'
import { TestimonialsSection } from '@/components/v2/testimonials-section'
import { PricingSectionV2 } from '@/components/v2/pricing-section-v2'

// Página em homologação: noindex até ser aprovada e promovida à raiz.
// Quando virar oficial, mover o conteúdo para app/page.tsx e remover o robots abaixo.
export const metadata: Metadata = {
  title: 'EidosForm — Formulários que as pessoas respondem até o fim',
  description:
    'Crie formulários conversacionais que transformam tráfego em leads. Meta Pixel, Google Ads e validação de CPF nativos. Feito no Brasil, pague em real.',
  robots: { index: false, follow: false },
}

const PERSONAS = [
  {
    icon: Crosshair,
    color: 'from-[#F5B731] to-[#E8923A]',
    title: 'Gestores de tráfego',
    bullets: [
      'Meta Pixel, Google Ads e GTM disparando direto do formulário',
      'Taxa de abandono pergunta a pergunta',
      'Redirecionamento pós-envio para a página de obrigado',
    ],
  },
  {
    icon: Users,
    color: 'from-blue-500 to-cyan-500',
    title: 'Agências',
    bullets: [
      'Formulários com a marca de cada cliente: logo, cores e tema',
      'Domínio próprio (formularios.cliente.com.br)',
      'Webhooks para entregar leads no CRM do cliente',
    ],
  },
  {
    icon: Rocket,
    color: 'from-violet-500 to-purple-600',
    title: 'Lançamentos e infoprodutos',
    bullets: [
      'Quiz de qualificação com lógica condicional',
      'Respostas parciais: o lead fica salvo mesmo sem clicar em enviar',
      'Webhooks para alimentar sua automação de email e WhatsApp',
    ],
  },
  {
    icon: BarChart3,
    color: 'from-emerald-400 to-teal-500',
    title: 'Pesquisas e NPS',
    bullets: [
      'Uma pergunta por vez: mais respostas completas',
      'Resultados em tempo real, sem planilha manual',
      'Exportação CSV para analisar onde quiser',
    ],
  },
]

const FEATURES = [
  {
    icon: BadgeCheck,
    color: 'from-[#F5B731] to-[#E8923A]',
    glow: 'shadow-[#F5B731]/20',
    title: 'Validação brasileira de verdade',
    desc: 'CPF e CNPJ validados na hora, endereço preenchido automaticamente pelo CEP. Chega de lead com documento inventado.',
  },
  {
    icon: UserRound,
    color: 'from-blue-500 to-cyan-500',
    glow: 'shadow-blue-500/20',
    title: 'Respostas parciais',
    desc: 'O que a pessoa digitou fica salvo antes de apertar enviar. Quem desistiu no meio vira lead mesmo assim.',
  },
  {
    icon: Megaphone,
    color: 'from-pink-500 to-rose-500',
    glow: 'shadow-pink-500/20',
    title: 'Tracking de conversão nativo',
    desc: 'Meta Pixel, Google Ads, GTM e TikTok Pixel configurados em cliques — sem gambiarra de código no formulário.',
  },
  {
    icon: GitBranch,
    color: 'from-violet-500 to-purple-600',
    glow: 'shadow-violet-500/20',
    title: 'Lógica condicional',
    desc: 'Se a resposta for X, pergunte Y. Qualifique leads e personalize o caminho de cada pessoa.',
  },
  {
    icon: BarChart3,
    color: 'from-emerald-400 to-teal-500',
    glow: 'shadow-emerald-500/20',
    title: 'Métricas que importam',
    desc: 'Taxa de conclusão, tempo de resposta e abandono por pergunta. Você vê exatamente onde o funil vaza.',
  },
  {
    icon: Shield,
    color: 'from-slate-400 to-slate-600',
    glow: 'shadow-slate-500/20',
    title: 'LGPD e segurança',
    desc: 'Dados criptografados em trânsito (TLS 1.3) e em repouso (AES-256), hospedados em conformidade com a LGPD.',
  },
]

const COMPARISON = [
  'Pague em real — sem dólar, sem IOF, sem surpresa no câmbio',
  'Validação de CPF e CNPJ nativa',
  'Endereço automático por CEP',
  'Suporte em português, por gente que fala a sua língua',
  '1.000 respostas/mês a partir de R$29 no plano anual',
  'LGPD desde o projeto, não como adaptação',
]

const FAQS = [
  {
    q: 'O EidosForm é realmente gratuito?',
    a: 'Sim! O plano Free é grátis para sempre, sem limite de tempo e sem precisar de cartão de crédito. Você cria até 3 formulários e coleta até 100 respostas por mês.',
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
    a: 'Sim, com o plano Professional você pode configurar um domínio personalizado. Basta adicionar um registro CNAME no seu provedor de DNS e seus formulários ficam acessíveis no seu próprio endereço.',
  },
  {
    q: 'Como funciona a API do EidosForm?',
    a: 'Com o plano Professional, você gera uma API Key nas configurações e pode integrar o EidosForm com qualquer sistema via REST API. Enviamos webhooks em tempo real para cada nova resposta.',
  },
  {
    q: 'Os dados das respostas ficam seguros?',
    a: 'Totalmente. Todos os dados são criptografados em trânsito (TLS 1.3) e em repouso (AES-256). Seguimos a LGPD e você pode exportar ou deletar todos os dados a qualquer momento.',
  },
  {
    q: 'Vocês oferecem desconto para startups e ONGs?',
    a: 'Sim! Oferecemos 50% de desconto para ONGs e startups em early stage. Entre em contato pelo suporte explicando seu caso e analisamos individualmente.',
  },
]

export default function LandingV2Page() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <EidosLogo variant="reduced" theme="dark" href="/v2" height={34} />
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#recursos" className="hover:text-white transition-colors">Recursos</a>
            <a href="#depoimentos" className="hover:text-white transition-colors">Depoimentos</a>
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
      <section className="pt-24 sm:pt-32 pb-16 sm:pb-20 px-4 sm:px-6 relative">
        <div className="absolute top-20 left-1/4 w-[300px] sm:w-[500px] h-[400px] bg-[#F5B731]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-10 items-center relative">
          <div className="text-center lg:text-left">
            <Badge className="mb-6 bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20 px-3 py-1.5 text-sm font-medium max-w-fit mx-auto lg:mx-0">
              🇧🇷 Feito no Brasil · Pague em real
            </Badge>

            <h1 className="text-[30px] sm:text-4xl md:text-5xl xl:text-6xl font-black tracking-tight mb-5 leading-[1.05]">
              Formulários que as pessoas
              <span className="block bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
                respondem até o fim
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-slate-400 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Crie em minutos um formulário conversacional que transforma seu tráfego
              em leads — com Meta Pixel, Google Ads e validação de CPF nativos.
              Uma pergunta de cada vez.
            </p>

            <div className="flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
                  Criar conta grátis
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <a href="#precos">
                <Button variant="ghost" size="lg" className="w-full sm:w-auto border border-white/30 text-slate-200 hover:bg-white/10 hover:text-white hover:border-white/50 px-8 py-6 text-base rounded-xl">
                  Ver planos
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

      {/* Personas */}
      <section className="py-20 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Para quem é</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Feito para quem vive de <span className="text-[#F5B731]">conversão</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Cada resposta a mais no seu formulário é um lead a menos para o concorrente.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PERSONAS.map(({ icon: Icon, color, title, bullets }) => (
              <div key={title} className="p-6 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all duration-300">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4 shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-white mb-3">{title}</h3>
                <ul className="space-y-2">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-slate-400 leading-relaxed">
                      <Check className="w-3.5 h-3.5 text-[#4BB678] mt-1 flex-shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Recursos</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              O que faz a resposta
              <span className="block text-slate-400">chegar até o fim</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Sem lista infinita de recursos que você nunca vai usar. Só o que faz seu formulário converter.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, color, glow, title, desc }) => (
              <div key={title} className="group p-6 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all duration-300 hover:-translate-y-0.5">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4 shadow-lg ${glow} group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Depoimentos */}
      <TestimonialsSection />

      {/* Comparativo BR vs gringas */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Por que trocar</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Cansado de pagar em <span className="text-[#F5B731]">dólar</span>?
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Typeform e similares cobram em dólar, somam IOF e não sabem o que é CPF.
              O EidosForm nasceu para o mercado brasileiro.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] bg-slate-900 text-xs sm:text-sm font-bold border-b border-white/10">
              <div className="px-4 sm:px-6 py-4 text-slate-400 uppercase tracking-wider text-xs">O que importa</div>
              <div className="px-4 sm:px-6 py-4 text-[#F5B731] text-center w-28 sm:w-36">EidosForm</div>
              <div className="px-4 sm:px-6 py-4 text-slate-500 text-center w-28 sm:w-36">Gringas</div>
            </div>
            {COMPARISON.map((row, i) => (
              <div
                key={row}
                className={`grid grid-cols-[1fr_auto_auto] items-center text-sm ${
                  i % 2 ? 'bg-white/[0.02]' : 'bg-transparent'
                } ${i < COMPARISON.length - 1 ? 'border-b border-white/5' : ''}`}
              >
                <div className="px-4 sm:px-6 py-4 text-slate-300 leading-snug">{row}</div>
                <div className="px-4 sm:px-6 py-4 flex justify-center w-28 sm:w-36">
                  <span className="w-7 h-7 rounded-full bg-[#4BB678]/15 flex items-center justify-center">
                    <Check className="w-4 h-4 text-[#4BB678]" />
                  </span>
                </div>
                <div className="px-4 sm:px-6 py-4 flex justify-center w-28 sm:w-36">
                  <span className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center">
                    <X className="w-4 h-4 text-slate-600" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSectionV2 />

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
                <EidosLogo variant="full" theme="dark" href="/v2" height={67} />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Formulários conversacionais que as pessoas respondem até o fim.
                Feito no Brasil, em real.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Produto</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#recursos" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Recursos</a></li>
                <li><a href="#precos" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Preços</a></li>
                <li><Link href="/login" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Painel</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Suporte</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#faq" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">FAQ</a></li>
                <li><a href="mailto:suporte@eidosform.com.br" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Contato</a></li>
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
