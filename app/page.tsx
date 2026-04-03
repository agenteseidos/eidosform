import Link from 'next/link'
import { ArrowRight, Zap, Shield, Globe, BarChart3, Palette, Code2, ChevronDown, Check, Sparkles, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PricingSection } from '@/components/pricing-section'
import { MobileMenu } from '@/components/mobile-menu'
import { EidosLogo } from '@/components/ui/eidos-logo'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <EidosLogo variant="reduced" theme="dark" href="/" height={34} />
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#recursos" className="hover:text-white transition-colors">Recursos</a>
            <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
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
      <section className="pt-24 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 relative">
        {/* Background glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#F5B731]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <Badge className="mb-6 bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20 px-3 py-1.5 text-sm font-medium max-w-fit">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            A nova geração de formulários
          </Badge>

          <h1 className="text-[28px] sm:text-6xl lg:text-7xl font-black tracking-tight mb-4 sm:mb-6 leading-none">
            Formulários que
            <span className="block bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
              as pessoas querem
            </span>
            responder
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Crie formulários conversacionais bonitos, colete respostas em tempo real e analise dados com inteligência. Uma pergunta de cada vez.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
                Criar conta grátis
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <a href="#como-funciona">
              <Button variant="ghost" size="lg" className="w-full sm:w-auto border border-white/30 text-slate-200 hover:bg-white/10 hover:text-white hover:border-white/50 px-8 py-6 text-base rounded-xl">
                Ver como funciona
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </a>
          </div>

          <p className="mt-6 text-sm sm:text-sm text-[14px] text-slate-400">
            Sem cartão de crédito · Setup em 30 segundos
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="pt-12 pb-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Recursos</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Tudo que você precisa,
              <span className="block text-slate-400">nada que não precisa</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Ferramentas poderosas para criar formulários que convertem.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: Zap,
                color: 'from-[#F5B731] to-[#E8923A]',
                glow: 'shadow-[#F5B731]/20',
                title: 'Builder Visual',
                desc: 'Arraste, solte e configure. Crie formulários complexos em minutos sem escrever uma linha de código.'
              },
              {
                icon: BarChart3,
                color: 'from-blue-500 to-cyan-500',
                glow: 'shadow-blue-500/20',
                title: 'Analytics em tempo real',
                desc: 'Acompanhe taxa de conclusão, tempo médio de resposta e abandono por pergunta com dashboards detalhados.'
              },
              {
                icon: Palette,
                color: 'from-violet-500 to-purple-600',
                glow: 'shadow-violet-500/20',
                title: 'Design personalizado',
                desc: 'Temas, fontes, cores e logos. Seus formulários refletem a identidade visual da sua marca.'
              },
              {
                icon: Globe,
                color: 'from-emerald-400 to-teal-500',
                glow: 'shadow-emerald-500/20',
                title: 'Domínio próprio',
                desc: 'Hospede seus formulários em formularios.suaempresa.com.br. Profissionalismo total.'
              },
              {
                icon: Code2,
                color: 'from-pink-500 to-rose-500',
                glow: 'shadow-pink-500/20',
                title: 'API & Webhooks',
                desc: 'Integre com qualquer sistema. Envie respostas para seu CRM, ERP ou sistema legado em tempo real.'
              },
              {
                icon: Shield,
                color: 'from-slate-400 to-slate-600',
                glow: 'shadow-slate-500/20',
                title: 'Segurança enterprise',
                desc: 'LGPD compliance, criptografia end-to-end, auditoria de acesso e controle granular de permissões.'
              },
            ].map(({ icon: Icon, color, glow, title, desc }) => (
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


      {/* CTA intermediário */}
      <div className="text-center py-12 px-4">
        <Link href="/register">
          <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
            Criar conta grátis
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </div>

      {/* How it works */}
      <section id="como-funciona" className="py-24 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">Como funciona</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Pronto em <span className="text-[#F5B731]">3 passos</span>
            </h2>
            <p className="text-slate-400 text-lg">Do zero ao formulário publicado em menos de 5 minutos.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Crie seu formulário',
                desc: 'Use nosso builder visual para adicionar perguntas, lógica condicional e personalizar o design.',
                color: 'text-[#F5B731]',
                border: 'border-[#F5B731]/20',
                bg: 'bg-[#F5B731]/5'
              },
              {
                step: '02',
                title: 'Publique e compartilhe',
                desc: 'Copie o link, incorpore no seu site ou envie por e-mail. Seu formulário fica online instantaneamente.',
                color: 'text-blue-400',
                border: 'border-blue-400/20',
                bg: 'bg-blue-400/5'
              },
              {
                step: '03',
                title: 'Analise os resultados',
                desc: 'Acompanhe respostas em tempo real, exporte dados e visualize métricas detalhadas.',
                color: 'text-[#4BB678]',
                border: 'border-[#4BB678]/20',
                bg: 'bg-[#4BB678]/5'
              }
            ].map(({ step, title, desc, color, border, bg }) => (
              <div key={step} className={`p-6 rounded-2xl ${bg} border ${border} text-center`}>
                <div className={`text-5xl font-black ${color} mb-4 opacity-60`}>{step}</div>
                <h3 className="text-lg font-bold text-white mb-3">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* CTA intermediário */}
      <div className="text-center py-12 px-4">
        <Link href="/register">
          <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
            Criar conta grátis
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </div>

      {/* Pricing — client component with toggle */}
      <PricingSection />

      {/* FAQ */}
      <section id="faq" className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">FAQ</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">Dúvidas frequentes</h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'O EidosForm é realmente gratuito?',
                a: 'Sim! O plano Free é grátis para sempre, sem limite de tempo e sem precisar de cartão de crédito. Você cria até 3 formulários e coleta até 100 respostas por mês.'
              },
              {
                q: 'Posso usar meu próprio domínio?',
                a: 'Sim, com o plano Professional você pode configurar um domínio personalizado. Basta adicionar um registro CNAME no seu provedor de DNS e seus formulários ficam acessíveis no seu próprio endereço.'
              },
              {
                q: 'Como funciona a API do EidosForm?',
                a: 'Com o plano Professional, você gera uma API Key nas configurações e pode integrar o EidosForm com qualquer sistema via REST API. Enviamos webhooks em tempo real para cada nova resposta.'
              },
              {
                q: 'Os dados das respostas ficam seguros?',
                a: 'Totalmente. Todos os dados são criptografados em trânsito (TLS 1.3) e em repouso (AES-256). Seguimos a LGPD e você pode exportar ou deletar todos os dados a qualquer momento.'
              },
              {
                q: 'Posso cancelar minha assinatura quando quiser?',
                a: 'Sim, sem burocracia. Você cancela pelo painel de configurações e o acesso ao plano pago continua até o fim do período já pago. Não há multas ou taxas de cancelamento.'
              },
              {
                q: 'Vocês oferecem desconto para startups e ONGs?',
                a: 'Sim! Oferecemos 50% de desconto para ONGs e startups em early stage. Entre em contato pelo suporte explicando seu caso e analisamos individualmente.'
              }
            ].map(({ q, a }, i) => (
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
            Pronto para começar?
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Crie seu primeiro formulário gratuitamente e veja a diferença.
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-lg px-10 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
              Criar conta grátis
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="mt-4 text-sm text-slate-500">Sem cartão de crédito · Setup em 30 segundos</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="mb-4">
                <EidosLogo variant="full" theme="dark" href="/" height={67} />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Formulários conversacionais que as pessoas querem responder.
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
                <li><a href="mailto:suporte@eidosform.com" className="hover:text-white transition-colors inline-flex items-center min-h-[44px] py-2">Contato</a></li>
                <li><span className="text-slate-600 cursor-not-allowed inline-flex items-center min-h-[44px] py-2">Documentação API</span></li>
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
