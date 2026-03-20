'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Sparkles,
  Menu,
  X,
  Star,
  Instagram,
  Linkedin,
  Youtube,
  Twitter,
  Fingerprint,
  MapPin,
  DollarSign,
  Headphones,
  Target,
  BarChart3,
  GitBranch,
  MessageSquare,
  Webhook,
  Globe,
  Download,
  Moon,
} from 'lucide-react'

/* ─── Fade-in wrapper ─── */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ─── Data ─── */
const plans = [
  {
    name: 'Free',
    monthly: 0,
    annual: 0,
    tagline: 'Para começar e testar',
    cta: 'Criar conta grátis',
    ctaStyle: 'outline' as const,
    features: [
      '3 formulários ativos',
      '100 respostas/mês',
      'Player conversacional',
      'Lógica condicional básica',
      'Marca d\'água EidosForm',
    ],
  },
  {
    name: 'Starter',
    monthly: 49,
    annual: 29,
    tagline: 'Para freelancers e pequenos negócios',
    cta: 'Começar com Starter',
    ctaStyle: 'solid' as const,
    features: [
      'Formulários ilimitados',
      '1.000 respostas/mês',
      'Sem marca d\'água',
      'Meta Pixel e Google Ads',
      'Respostas parciais',
      'Export CSV',
      'Validação de CPF/CNPJ',
      'Busca de CEP automática',
    ],
  },
  {
    name: 'Plus',
    monthly: 127,
    annual: 97,
    tagline: 'Para agências e gestores de tráfego',
    cta: 'Começar com Plus',
    ctaStyle: 'solid' as const,
    popular: true,
    features: [
      'Tudo do Starter, mais:',
      'Respostas ilimitadas',
      'TikTok Pixel + GTM',
      'Webhooks',
      'Domínio personalizado',
      'Taxa de abandono por campo',
      'Dark mode',
      'Suporte prioritário',
    ],
  },
  {
    name: 'Professional',
    monthly: 257,
    annual: 197,
    tagline: 'Para times e operações de alto volume',
    cta: 'Falar com o time',
    ctaStyle: 'outline' as const,
    features: [
      'Tudo do Plus, mais:',
      'API v1 completa',
      'Múltiplos usuários',
      'Relatórios avançados',
      'Onboarding dedicado',
      'SLA de suporte',
    ],
  },
]

const faqs = [
  { q: 'Preciso de cartão de crédito pra criar conta?', a: 'Não. O plano Free não pede nenhum dado de pagamento. Você cria a conta, usa e só coloca cartão se quiser fazer upgrade.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim. Sem fidelidade, sem multa, sem enrolação. Se quiser cancelar, você cancela. Simples assim.' },
  { q: 'O EidosForm funciona com Meta Pixel e Google Ads ao mesmo tempo?', a: 'Sim. Você pode ativar Meta Pixel, Google Ads, TikTok Pixel e GTM no mesmo formulário — cada um rastreando o evento que você configurou.' },
  { q: 'Como funciona a validação de CPF/CNPJ?', a: 'É nativa — sem plugin externo. Você ativa a validação no campo e o EidosForm verifica automaticamente se o documento é válido antes de aceitar o envio.' },
  { q: 'Consigo integrar com meu CRM ou ferramenta de automação?', a: 'Sim. Nos planos Plus e Professional você tem acesso a Webhooks — que conecta com n8n, Make, Zapier e qualquer ferramenta que aceite requisição HTTP. O plano Professional também inclui a API v1 completa.' },
  { q: 'Qual a diferença entre o modo conversacional e o formulário tradicional?', a: 'No modo conversacional, o usuário responde uma pergunta por vez — como se fosse uma conversa. No modo tradicional, todos os campos aparecem juntos. Você escolhe o modo na hora de criar o form.' },
  { q: 'Os dados ficam seguros?', a: 'Sim. Seus dados e os dos seus leads ficam armazenados com segurança. Se precisar de detalhes técnicos sobre infraestrutura e compliance, nossa equipe responde tudo.' },
  { q: 'Tem suporte em português?', a: 'Tem. Time brasileiro, atendimento em português. Sem abrir ticket em inglês pra esperar 3 dias.' },
  { q: 'Posso usar meu próprio domínio nos formulários?', a: 'Sim, nos planos Plus e Professional. Você publica o form em form.seudominio.com.br em vez do link padrão do EidosForm.' },
  { q: 'O que acontece se eu bater o limite de respostas do meu plano?', a: 'Você recebe um aviso antes de bater o limite. Após o limite, o formulário continua online mas novas respostas ficam pausadas até o próximo ciclo ou até você fazer upgrade. Nenhum dado é perdido.' },
]

/* ─── Components ─── */

function NavBar() {
  const [open, setOpen] = useState(false)
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F5B731] to-[#E8923A] flex items-center justify-center shadow-lg shadow-[#F5B731]/20">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">EidosForm</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login">
              <button className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5">Entrar</button>
            </Link>
            <Link href="/login">
              <button className="text-sm font-semibold bg-[#F5B731] hover:bg-[#E8923A] text-black px-4 py-2 rounded-lg shadow-lg shadow-[#F5B731]/20 transition-all hover:shadow-[#E8923A]/30">
                Criar conta grátis
              </button>
            </Link>
          </div>
          <button className="md:hidden text-slate-400" onClick={() => setOpen(!open)}>
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-t border-white/5 bg-[#0A0A0F]"
          >
            <div className="px-4 py-4 flex flex-col gap-3 text-sm">
              <Link href="/login">
                <button className="w-full text-sm font-semibold bg-[#F5B731] hover:bg-[#E8923A] text-black px-4 py-2.5 rounded-lg mt-1">
                  Criar conta grátis
                </button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-white/5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-5 text-left gap-4">
        <span className="font-medium text-white text-base">{q}</span>
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }}>
          <span className="text-[#F5B731] text-xl font-light select-none">+</span>
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-slate-400 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Main Page ─── */
export default function PgbLandingPage() {
  const [annual, setAnnual] = useState(true)

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">
      <NavBar />

      {/* ══════ HERO ══════ */}
      <section className="pt-32 pb-24 px-4 sm:px-6 relative">
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#F5B731]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <Reveal>
            <span className="inline-flex items-center gap-1.5 mb-6 bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20 px-4 py-1.5 text-sm font-medium rounded-full">
              <Sparkles className="w-3.5 h-3.5" />
              Formulários inteligentes para o Brasil
            </span>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight mb-6 leading-[1.05]">
              Formulários que convertem.{' '}
              <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
                Rastreamento que funciona.
              </span>{' '}
              <span className="block mt-1">Tudo em real.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              Crie formulários inteligentes com lógica condicional, validação de CPF/CNPJ, integração nativa com Meta Pixel, Google Ads e TikTok — e pague em reais, sem surpresa no cartão.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/login">
                <button className="w-full sm:w-auto bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-4 rounded-xl shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5 flex items-center gap-2">
                  Criar minha conta grátis
                  <ArrowRight className="w-5 h-5" />
                </button>
              </Link>
              <Link href="/login">
                <button className="text-sm text-slate-400 hover:text-white transition-colors">
                  Já tenho conta → Entrar
                </button>
              </Link>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              Sem cartão de crédito. Começa em menos de 2 minutos.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ══════ PROVA SOCIAL ══════ */}
      <section className="py-20 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Quem já usa o EidosForm</span>
              <h2 className="text-3xl sm:text-4xl font-black mt-3 mb-4">Profissionais que não aceitam menos</h2>
            </div>
          </Reveal>

          {/* Logos placeholder */}
          <Reveal delay={0.05}>
            <div className="flex flex-wrap items-center justify-center gap-8 mb-16 opacity-40">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-28 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xs text-slate-500 font-mono">
                  [PLACEHOLDER]
                </div>
              ))}
            </div>
          </Reveal>

          {/* Testimonials */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[1, 2, 3].map((i) => (
              <Reveal key={i} delay={i * 0.05}>
                <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6">
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star key={s} className="w-4 h-4 fill-[#F5B731] text-[#F5B731]" />
                    ))}
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed mb-4 italic">
                    &quot;[PLACEHOLDER — substituir por depoimento real]&quot;
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-white/10" />
                    <div>
                      <p className="text-sm font-medium text-white">[Nome]</p>
                      <p className="text-xs text-slate-500">[Cargo, Empresa]</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Numbers */}
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-12 text-center">
              {['[X] formulários criados', '[Y] respostas coletadas', '[Z] usuários ativos'].map((txt, i) => (
                <div key={i}>
                  <p className="text-3xl font-black text-[#F5B731]">[PLACEHOLDER]</p>
                  <p className="text-sm text-slate-500 mt-1">{txt}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════ FEITO PARA O BRASIL ══════ */}
      <section id="feito-brasil" className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Não é mais um Typeform</span>
              <h2 className="text-3xl sm:text-5xl font-black mt-3 mb-4">
                Feito para quem trabalha com o{' '}
                <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
                  Brasil de verdade
                </span>
              </h2>
              <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                Enquanto as ferramentas gringas ignoram o mercado brasileiro, o EidosForm nasceu aqui — e fala a mesma língua que o seu negócio.
              </p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Fingerprint, title: 'Valida CPF e CNPJ nativamente', desc: 'Sem gambiarra, sem plugin externo. Valida direto no campo — e barra entrada inválida antes de chegar na sua base.' },
              { icon: MapPin, title: 'Busca de CEP automática', desc: 'O usuário digita o CEP e o endereço preenche sozinho. Menos atrito, mais conversão, menos dado errado.' },
              { icon: DollarSign, title: 'Pague em real, sem variação cambial', desc: 'R$49/mês é R$49/mês. Sem dólar, sem IOF, sem surpresa no fechamento do cartão.' },
              { icon: Headphones, title: 'Suporte em português', desc: 'Time brasileiro, atendimento em português, sem ticket em inglês pra esperar 3 dias.' },
            ].map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 h-full hover:border-[#F5B731]/20 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-[#F5B731]/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-[#F5B731]" />
                  </div>
                  <h3 className="font-bold text-white mb-2">{title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
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
        <p className="mt-3 text-sm text-slate-500">Grátis para sempre · Sem cartão de crédito</p>
      </div>

      {/* ══════ FEATURES COMO BENEFÍCIOS ══════ */}
      <section id="recursos" className="py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Por dentro do produto</span>
              <h2 className="text-3xl sm:text-5xl font-black mt-3 mb-4">
                Cada detalhe pensado pra você{' '}
                <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">converter mais</span>
              </h2>
            </div>
          </Reveal>

          <div className="space-y-20">
            {[
              {
                icon: Target,
                title: 'Rastreamento como um profissional',
                pain: 'Você sobe uma campanha, o lead preenche o form — e você não sabe se o pixel disparou, se o evento registrou, se a conversão foi atribuída.',
                solution: 'O EidosForm integra nativo com Meta Pixel, Google Ads, TikTok Pixel e Google Tag Manager.',
                result: 'Rastreie cada envio, abandono e resposta parcial. Otimize campanha com dado real — não chute.',
                tags: ['Meta Pixel', 'Google Ads', 'TikTok Pixel', 'GTM'],
              },
              {
                icon: BarChart3,
                title: 'Respostas parciais + taxa de abandono',
                pain: '60% das pessoas começam a preencher e largam no meio. Você perde o lead e nem sabe em que campo ele parou.',
                solution: 'O EidosForm captura respostas parciais em tempo real e mostra exatamente onde o usuário abandona.',
                result: 'Você descobre o gargalo, corrige o form e recupera leads que antes iam embora sem deixar rastro.',
              },
              {
                icon: GitBranch,
                title: 'Lógica condicional',
                pain: 'Um form genérico que pergunta tudo pra todo mundo afasta o lead qualificado e gera dado inútil.',
                solution: 'Com lógica condicional, cada pergunta aparece só pra quem precisa responder.',
                result: 'Forms mais curtos, experiência mais fluida, lead mais qualificado no final.',
              },
              {
                icon: MessageSquare,
                title: 'Player conversacional',
                pain: 'Formulários de grade cansam e parecem burocracia. O lead desanima antes de terminar.',
                solution: 'O modo conversacional do EidosForm exibe uma pergunta por vez — como uma conversa, não um interrogatório.',
                result: 'Mais tempo na página, mais respostas completas, mais conversão.',
              },
              {
                icon: Webhook,
                title: 'Automações com Webhooks e API',
                pain: 'Você precisa copiar resposta, colar no CRM, avisar o time no WhatsApp, criar o contato no e-mail marketing… na mão.',
                solution: 'Webhooks para qualquer automação (n8n, Make, Zapier) + API v1 para integrações customizadas.',
                result: 'O lead entra no form e aparece no seu CRM, no seu WhatsApp, na sua planilha — sem você tocar em nada.',
              },
              {
                icon: Globe,
                title: 'Domínio personalizado',
                pain: 'Link de formulário com domínio genérico passa pouca confiança — e no Brasil, desconfiança mata conversão.',
                solution: 'Publique seus forms no seu próprio domínio.',
                result: 'Mais credibilidade, mais cliques, mais leads.',
              },
            ].map((f, i) => (
              <Reveal key={i}>
                <div className={`flex flex-col ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} gap-8 md:gap-12 items-center`}>
                  <div className="w-full md:w-1/2 aspect-video bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-center">
                    <f.icon className="w-16 h-16 text-[#F5B731]/30" />
                  </div>
                  <div className="w-full md:w-1/2">
                    <h3 className="text-2xl font-black mb-4 text-white">{f.title}</h3>
                    <p className="text-slate-400 mb-3"><span className="text-red-400 font-semibold">Dor:</span> {f.pain}</p>
                    <p className="text-slate-400 mb-3"><span className="text-[#F5B731] font-semibold">Solução:</span> {f.solution}</p>
                    <p className="text-slate-400 mb-4"><span className="text-emerald-400 font-semibold">Resultado:</span> {f.result}</p>
                    {f.tags && (
                      <div className="flex flex-wrap gap-2">
                        {f.tags.map((t) => (
                          <span key={t} className="text-xs bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20 px-3 py-1 rounded-full">✅ {t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Minor features */}
          <Reveal>
            <div className="grid sm:grid-cols-2 gap-6 mt-16">
              {[
                { icon: Download, title: 'Export CSV', desc: 'Exporte tudo em CSV com um clique. Dados no seu Excel/Sheets quando quiser.' },
                { icon: Moon, title: 'Dark mode', desc: 'Porque ninguém merece olhar tela branca às 23h configurando funil. Olhos intactos pra trabalhar de noite.' },
              ].map(({ icon: Icon, title, desc }, i) => (
                <div key={i} className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl bg-[#F5B731]/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-[#F5B731]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white mb-1">{title}</h4>
                    <p className="text-sm text-slate-400">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
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
        <p className="mt-3 text-sm text-slate-500">Grátis para sempre · Sem cartão de crédito</p>
      </div>

      {/* ══════ SEGMENTAÇÃO POR PERSONA ══════ */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Para quem é o EidosForm?</span>
              <h2 className="text-3xl sm:text-5xl font-black mt-3 mb-4">
                Não importa como você gera leads —{' '}
                <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">o EidosForm foi feito pra você</span>
              </h2>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { tag: '📊 Gestor de Tráfego', title: 'Rastreamento na veia, resultado no relatório', desc: 'Você vive de dado. Pixel que dispara errado é campanha que otimiza errado. Com o EidosForm, cada conversão é registrada no Meta, Google e TikTok — e você mostra resultado pro cliente com confiança.', color: 'from-blue-500/10 to-blue-500/5' },
              { tag: '🏢 Agências', title: 'Uma ferramenta, vários clientes, zero confusão', desc: 'Gerencie forms de múltiplos clientes, personalize com domínio deles, automatize a entrega dos leads para os CRMs deles — e ainda exporte relatório quando precisar prestar conta.', color: 'from-purple-500/10 to-purple-500/5' },
              { tag: '🎓 Infoprodutores', title: 'Qualifique antes de vender. Venda mais, atenda menos.', desc: 'Crie formulários de aplicação, qualificação de leads e pesquisas de público com lógica condicional. Saiba exatamente quem está pronto pra comprar e quem ainda precisa de aquecimento.', color: 'from-emerald-500/10 to-emerald-500/5' },
              { tag: '🏥 Clínicas · Imobiliárias · Consultórios', title: 'Lead qualificado sem depender de terceiros', desc: 'Capte nome, telefone, CPF e CEP (com preenchimento automático) — tudo validado, tudo organizado, tudo pronto pra entrar no seu atendimento sem retrabalho.', color: 'from-rose-500/10 to-rose-500/5' },
            ].map(({ tag, title, desc, color }, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <div className={`bg-gradient-to-br ${color} border border-white/5 rounded-2xl p-8 h-full hover:border-[#F5B731]/20 hover:-translate-y-1 transition-all duration-300`}>
                  <span className="text-xs font-medium text-slate-400 bg-white/5 px-3 py-1 rounded-full">{tag}</span>
                  <h3 className="text-xl font-black text-white mt-4 mb-3">{title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-6">{desc}</p>
                  <Link href="/login" className="inline-flex items-center text-sm font-semibold text-[#F5B731] hover:text-[#E8923A] transition-colors gap-1">
                    Criar meu form agora <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ COMO FUNCIONA ══════ */}
      <section className="py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Simples assim</span>
              <h2 className="text-3xl sm:text-5xl font-black mt-3">
                Do zero ao form publicado em{' '}
                <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">menos de 5 minutos</span>
              </h2>
            </div>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Crie sua conta', desc: 'Cadastro sem cartão de crédito. Em 2 minutos você já está dentro da plataforma.' },
              { step: '02', title: 'Monte seu formulário', desc: 'Arraste os campos, configure a lógica condicional, ative os pixels que precisa. Interface visual, sem código.' },
              { step: '03', title: 'Publique e rastreie', desc: 'Compartilhe o link ou incorpore no seu site. Acompanhe respostas, abandonos e conversões em tempo real.' },
            ].map(({ step, title, desc }, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <div className="text-center">
                  <span className="text-5xl font-black text-[#F5B731]/20">{step}</span>
                  <h3 className="text-xl font-bold text-white mt-2 mb-3">{title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <div className="text-center mt-12">
              <Link href="/login">
                <button className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-4 rounded-xl shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
                  Começar agora — é grátis
                </button>
              </Link>
            </div>
          </Reveal>
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
        <p className="mt-3 text-sm text-slate-500">Grátis para sempre · Sem cartão de crédito</p>
      </div>

      {/* ══════ PLANOS E PREÇOS ══════ */}
      <section id="precos" className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-sm uppercase tracking-widest text-slate-500 font-medium">Investimento</span>
              <h2 className="text-3xl sm:text-5xl font-black mt-3 mb-4">
                Preço em real. Sem surpresa.{' '}
                <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">Sem variação cambial.</span>
              </h2>
              <p className="text-slate-400 text-lg">Escolha o plano ideal e economize pagando anual.</p>
            </div>
          </Reveal>

          {/* Toggle */}
          <Reveal delay={0.05}>
            <div className="flex items-center justify-center gap-4 mb-12">
              <button
                onClick={() => setAnnual(false)}
                className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${!annual ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Mensal
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${annual ? 'bg-[#F5B731]/10 text-[#F5B731] border border-[#F5B731]/20' : 'text-slate-400 hover:text-white'}`}
              >
                Anual <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">economize até 43%</span>
              </button>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan, i) => (
              <Reveal key={plan.name} delay={i * 0.05}>
                <div className={`relative bg-white/[0.03] border rounded-2xl p-6 h-full flex flex-col ${plan.popular ? 'border-[#F5B731]/40 shadow-lg shadow-[#F5B731]/5' : 'border-white/5'}`}>
                  {plan.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F5B731] text-black text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      <Star className="w-3 h-3" /> Mais popular
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 mb-4">{plan.tagline}</p>
                  <div className="mb-6">
                    <span className="text-4xl font-black text-white">
                      R${annual ? plan.annual : plan.monthly}
                    </span>
                    <span className="text-slate-400 text-sm">/mês</span>
                    {annual && plan.annual > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        R${plan.annual * 12}/ano · faturado anualmente
                      </p>
                    )}
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                        <Check className="w-4 h-4 text-[#F5B731] shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/login">
                    <button
                      className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                        plan.popular
                          ? 'bg-[#F5B731] hover:bg-[#E8923A] text-black shadow-lg shadow-[#F5B731]/20'
                          : plan.ctaStyle === 'solid'
                            ? 'bg-white/10 hover:bg-white/15 text-white'
                            : 'border border-white/10 text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {plan.cta}
                    </button>
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <p className="text-center text-sm text-slate-500 mt-8">
              Todos os planos pagos incluem 7 dias de teste sem compromisso. Cancele quando quiser.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ══════ FAQ ══════ */}
      <section id="faq" className="py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-3xl mx-auto">
          <Reveal>
            <h2 className="text-3xl sm:text-4xl font-black text-center mb-12">
              Perguntas que a gente recebe{' '}
              <span className="text-slate-400">(e responde de verdade)</span>
            </h2>
          </Reveal>
          <div>
            {faqs.map((faq, i) => (
              <FAQItem key={i} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════ CTA FINAL ══════ */}
      <section className="py-24 px-4 sm:px-6 bg-gradient-to-b from-[#0A0A0F] to-[#111118]">
        <div className="max-w-3xl mx-auto text-center">
          <Reveal>
            <h2 className="text-3xl sm:text-5xl font-black mb-6 leading-tight">
              Chega de form genérico.{' '}
              <span className="bg-gradient-to-r from-[#F5B731] to-[#E8923A] bg-clip-text text-transparent">
                Chega de pixel que não dispara.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={0.05}>
            <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto">
              O EidosForm é a ferramenta que o profissional brasileiro de marketing estava esperando. Criada aqui, pra quem trabalha aqui.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/login">
                <button className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-base px-8 py-4 rounded-xl shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5 flex items-center gap-2">
                  Criar minha conta agora — é grátis
                  <ArrowRight className="w-5 h-5" />
                </button>
              </Link>
              <a href="mailto:contato@eidosform.com" className="text-sm text-slate-400 hover:text-white transition-colors">
                Ainda na dúvida? Fala com a gente →
              </a>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              Sem cartão de crédito. Sem contrato. Começa em 2 minutos.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className="py-16 px-4 sm:px-6 border-t border-white/5 bg-[#07070B]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#F5B731] to-[#E8923A] flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-base font-bold">EidosForm</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">Formulários inteligentes para o mercado brasileiro.</p>
            </div>

            {[
              { title: 'Produto', links: ['Recursos', 'Planos e preços', 'Integrações', 'API', 'Novidades'] },
              { title: 'Empresa', links: ['Sobre a Eidos', 'Blog', 'Carreiras', 'Imprensa'] },
              { title: 'Suporte', links: ['Central de ajuda', 'Documentação', 'Status da plataforma', 'Contato'] },
              { title: 'Legal', links: ['Termos de uso', 'Política de privacidade', 'Política de cookies', 'LGPD'] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">{col.title}</h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a href="#" className="text-sm text-slate-500 hover:text-white transition-colors hover:underline underline-offset-4">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-white/5 gap-4">
            <p className="text-xs text-slate-600">
              © 2026 EidosForm · Todos os direitos reservados · Produto da Eidos · 🇧🇷 Feito no Brasil
            </p>
            <div className="flex items-center gap-4">
              {[Instagram, Linkedin, Youtube, Twitter].map((Icon, i) => (
                <a key={i} href="#" className="text-slate-600 hover:text-white transition-colors">
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
