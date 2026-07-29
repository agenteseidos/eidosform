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
  ClipboardCheck,
  Code2,
  CornerDownRight,
  Crosshair,
  EyeOff,
  Globe,
  LineChart,
  Link2,
  MessageCircle,
  Target,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MobileMenu } from '@/components/mobile-menu'
import { EidosLogo } from '@/components/ui/eidos-logo'
import { Reveal } from '@/components/ui/reveal'
import { HeroDemo } from '@/components/v3/hero-demo'
import { TestimonialsSection } from '@/components/v3/testimonials-section'
import { PricingSectionV3 } from '@/components/v3/pricing-section-v3'
import { IntegrationsGrid } from '@/components/v3/integrations-grid'
import { MockupAgency, MockupSegmentation } from '@/components/v3/section-mockups'
import { ThemeCarousel } from '@/components/ui/theme-carousel'

// Página em homologação (modelada na yayforms.com/br/typeform-alternative):
// noindex até ser aprovada e promovida à raiz. Claims re-verificados no código
// em 2026-07-28 (auditoria LP + revisão Codex): campos ocultos por URL
// (lib/url-params.ts), eventos por conjunto de respostas (evaluateAnswerSetEvents),
// UTM no webhook, alerta de lead abandonado (timer na VPS) e tela de abandono por
// pergunta (analytics-panel) — tudo EXISTE e está ligado.
//
// ⚠️ NÃO ANUNCIAR (revisão Codex 2026-07-28, promessa sem lastro):
//   - CAPI server-side: existe UM pixel/token GLOBAL, mas os pixels dos clientes
//     são POR FORMULÁRIO; todo evento sai como 'Lead' e o event_id é o nome do
//     evento (sem dedup real com o browser). Só anunciar após config por cliente.
//   - "UTM aparece na mensagem do WhatsApp por padrão": as variáveis {utm_*}
//     existem, mas os templates PADRÃO não as usam.
//   - "tempo médio de preenchimento": a tabela responses não tem timestamp de
//     início (só submitted_at/last_activity_at) — a métrica não é calculável hoje.
export const metadata: Metadata = {
  title: 'EidosForm | Formulários que as pessoas respondem até o fim',
  description:
    'A alternativa brasileira ao Typeform para tráfego pago: Meta Pixel, Google Ads, GTM e TikTok nativos, UTMs em cada lead e alerta de lead no seu WhatsApp. Pague em real.',
  robots: { index: false, follow: false },
}

// Funil oficial de migração (2026-07-02, executa o TODO original): form /f/migracao →
// tela de obrigado → botão wa.me pra Elen, que recomenda o plano automaticamente.
const MIGRATION_FORM = '/f/migracao'

const DIFFERENTIALS = [
  { icon: Target, text: 'Meta Pixel, Google Ads, GTM e TikTok nativos no Plus' },
  { icon: Crosshair, text: 'Conversões personalizadas disparadas pela resposta' },
  { icon: LineChart, text: 'UTMs gravadas em cada lead, com janela de 30 dias' },
  { icon: BadgeCheck, text: 'CPF, CNPJ e CEP validados nativamente' },
  { icon: Globe, text: 'Pague em real, sem dólar e sem IOF' },
  { icon: UserRound, text: 'Suporte em português' },
]

// Um acento só na página inteira (o amarelo da marca). O violeta aparece
// apenas na seção de agências, que é um segmento à parte.
const BRAND_TILE = 'from-[#F5B731] to-[#E8923A]'

const TRAFFIC_FEATURES = [
  {
    icon: Target,
    color: BRAND_TILE,
    title: 'Pixels nativos, sem gambiarra',
    desc: 'Meta Pixel, Google Ads, GTM e TikTok configurados em cliques. Evento no início e na conclusão do formulário, direto no seu gerenciador de anúncios.',
  },
  {
    icon: Crosshair,
    color: BRAND_TILE,
    title: 'Conversão por resposta',
    desc: 'Dispare um evento diferente conforme a resposta — ou combine várias: "LeadQualificado" só quando orçamento E prazo baterem. A campanha otimiza para quem compra, não para quem clica.',
  },
  {
    icon: LineChart,
    color: BRAND_TILE,
    title: 'UTMs em cada lead',
    desc: 'Origem, campanha e termo gravados com cada resposta (até as parciais), com janela de 30 dias. Sai no CSV, cai no Google Sheets e segue no webhook até o seu CRM.',
  },
  {
    icon: EyeOff,
    color: BRAND_TILE,
    title: 'Campos ocultos por URL',
    desc: 'Adicione ?vendedor=ana ou qualquer parâmetro à URL do anúncio: o valor é capturado e gravado junto do lead, sem nunca aparecer no formulário.',
  },
  {
    icon: BarChart3,
    color: BRAND_TILE,
    title: 'Abandono por pergunta',
    desc: 'Veja no painel após qual pergunta o lead parou. E com respostas parciais, o que ele digitou antes de sair já está salvo. O clique que você pagou não vira lead perdido.',
  },
]

const EMPHASIS_SECTIONS = [
  {
    id: 'segmentacao',
    title: 'Segmente sua audiência com lógica condicional',
    desc: 'Se a resposta for X, pergunte Y. Monte quizzes que separam o curioso do comprador, personalize o caminho de cada pessoa e qualifique o lead antes mesmo de falar com ele.',
    bullets: [
      'Caminhos diferentes conforme a resposta',
      'Quiz de qualificação para high-ticket',
      'Mapa da Lógica: enxergue todos os caminhos e becos sem saída do seu funil',
      '20 tipos de pergunta e 11 templates prontos para começar',
    ],
    mockup: 'segmentation' as const,
  },
  {
    id: 'marca',
    title: 'Formulário com a cara da sua marca',
    desc: 'Escolha um dos 7 temas profissionais, coloque a sua logo na tela de boas-vindas e publique no seu próprio domínio. O formulário chega com a sua cara, não com a nossa.',
    bullets: [
      '7 temas profissionais prontos',
      'Sua logo na tela de boas-vindas',
      "Sem marca d'água a partir do Plus",
      'Domínio próprio no Professional (formularios.suamarca.com.br)',
    ],
    mockup: 'brand' as const,
  },
]

// Compartilhe virou faixa própria: quebra a sequência de seções split
// (regra da design-taste-frontend: no máximo 2 splits consecutivos).
const SHARE_ITEMS = [
  { icon: Link2, title: 'Link direto', desc: 'Pronto para anúncio, bio ou WhatsApp: publicou, compartilhou.' },
  { icon: Code2, title: 'Embed no seu site', desc: 'Incorpore o formulário na sua página ou landing com um snippet.' },
  { icon: CornerDownRight, title: 'Redirecionamento pós-envio', desc: 'Ao final, o lead segue direto para a página de obrigado do seu funil.' },
]

// O mockup estático da marca deu lugar ao carrossel com os 7 temas reais.
function BrandThemesCarousel() {
  return <ThemeCarousel variant="dark" />
}

const SECTION_MOCKUPS = {
  segmentation: MockupSegmentation,
  brand: BrandThemesCarousel,
} as const

const AGENCY_BULLETS = [
  'Cada formulário com um dos 7 temas + a logo do cliente na abertura',
  'Domínio personalizado por formulário, no endereço de cada cliente',
  'Webhooks levando cada lead direto ao CRM do cliente (com as UTMs juntas)',
  'Templates prontos de captura e briefing feitos para agência',
  'API e webhooks para plugar no stack que a agência já usa',
  '15.000 respostas/mês e prioridade máxima no suporte',
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
  { label: 'Suporte em português', eidos: true, typeform: false },
  { label: 'Integração nativa com Salesforce', eidos: false, typeform: true },
  { label: 'Pagamentos embutidos (Stripe)', eidos: false, typeform: true },
  { label: 'Certificações SOC 2 / HIPAA', eidos: false, typeform: true },
]

const FAQS = [
  {
    q: 'Estou em outra ferramenta. Como migro para o EidosForm?',
    a: 'A gente migra para você, seja do Typeform, do Google Forms ou de qualquer outra plataforma. Chame a gente no WhatsApp com os links dos seus formulários: fazemos uma análise gratuita e te dizemos qual plano comporta o que você usa hoje. Assinando qualquer plano pago, recriamos tudo (até 10 formulários) em no máximo 3 dias úteis. Você só revisa e publica.',
  },
  {
    q: 'O que o Typeform tem que vocês não têm?',
    a: 'Integração nativa com Salesforce, campos de pagamento embutidos (Stripe) e certificações SOC 2/HIPAA. Se a sua operação exige isso, o Typeform é a escolha certa. Para captar e qualificar leads no Brasil com tráfego pago, o EidosForm entrega mais, por bem menos.',
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
    a: 'Sim. Origem, mídia, campanha, termo e conteúdo (utm_source, utm_medium, utm_campaign, utm_term, utm_content) são capturados na chegada e gravados junto de cada resposta (inclusive as parciais), com janela de atribuição de 30 dias. Tudo sai na exportação CSV e Excel, cai na planilha do Google Sheets e segue no webhook até o seu CRM.',
  },
  {
    q: 'Recebo os leads no meu WhatsApp?',
    a: 'Sim, no plano Plus. Cada novo lead chega no seu número com as respostas completas, a campanha de origem (UTM) e um link wa.me pronto para respondê-lo em um toque. E se o lead parar no meio do formulário, você recebe um alerta de lead incompleto com o que ele já preencheu — a tempo de recuperá-lo.',
  },
  {
    q: 'Quantos tipos de pergunta e modelos prontos existem?',
    a: 'São 20 tipos de pergunta — de texto e múltipla escolha a CPF/CNPJ, endereço com CEP automático, agendamento com Calendly, upload de arquivo e NPS — e 11 templates prontos, incluindo captura para agência de tráfego e briefing de agência. Além de 7 temas visuais e do Mapa da Lógica, que mostra visualmente todos os caminhos do seu formulário.',
  },
  {
    q: 'O que acontece quando atinjo o limite de respostas do mês?',
    a: 'Seu formulário para de receber novas respostas até a virada do ciclo mensal. Nunca cobramos nada a mais automaticamente. Você pode fazer upgrade a qualquer momento e a cota nova vale na hora.',
  },
  {
    q: 'Quais formas de pagamento vocês aceitam?',
    a: 'Cartão de crédito, com cobrança em reais, sem IOF e sem variação de câmbio. Você escolhe entre assinatura mensal ou anual (com até 41% de desconto).',
  },
  {
    q: 'E se eu assinar e me arrepender?',
    a: 'Você tem 7 dias de garantia em qualquer plano pago: é só pedir e devolvemos 100% do valor, sem perguntas. Depois desse prazo, você ainda pode cancelar quando quiser e mantém o acesso até o fim do período já pago.',
  },
  {
    q: 'Posso cancelar minha assinatura quando quiser?',
    a: 'Sim, sem burocracia. Você cancela pelo painel de configurações e o acesso ao plano pago continua até o fim do período já pago. Não há multas ou taxas de cancelamento.',
  },
  {
    q: 'Posso usar meu próprio domínio?',
    a: 'Sim, com o plano Professional você pode configurar um domínio personalizado. Basta adicionar um registro CNAME no seu provedor de DNS e seus formulários ficam acessíveis no seu próprio endereço, ou no do seu cliente.',
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
    <div className="landing-display min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">
      {/* Rede de segurança: sem JS o motion não hidrata e todo o conteúdo com
          reveal ficaria preso em opacity:0. O noscript devolve tudo visível. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html:
            '<style>.landing-display [style*="opacity:0"]{opacity:1!important;transform:none!important}</style>',
        }}
      />
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
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 lg:gap-10 items-center relative">
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
                  Criar meu primeiro formulário grátis
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
          {DIFFERENTIALS.map(({ icon: Icon, text }, i) => (
            <Reveal key={text} index={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
              <span className="w-8 h-8 min-w-8 rounded-lg bg-[#F5B731]/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#F5B731]" />
              </span>
              <p className="text-xs sm:text-sm text-slate-300 leading-snug">{text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Migração */}
      <section className="py-12 sm:py-20 px-4 sm:px-6">
        <Reveal className="max-w-4xl mx-auto">
          <div className="rounded-3xl border border-[#F5B731]/20 bg-gradient-to-br from-[#F5B731]/[0.08] to-transparent p-8 sm:p-12 text-center">
            <span className="inline-flex w-12 h-12 rounded-2xl bg-[#F5B731]/15 items-center justify-center mb-5">
              <ArrowRightLeft className="w-6 h-6 text-[#F5B731]" />
            </span>
            <h2 className="text-2xl sm:text-4xl font-black mb-3">
              Vindo de outra ferramenta? <span className="text-[#F5B731]">A gente migra para você.</span>
            </h2>
            <p className="text-slate-400 text-lg mb-7 max-w-2xl mx-auto">
              Typeform, Google Forms ou qualquer outra: envie os links dos seus formulários e
              fazemos uma <strong className="text-white">análise gratuita</strong>. Dizemos
              qual plano comporta o que você usa hoje. Assinou, recriamos tudo em até
              3 dias úteis. Você só revisa e publica.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <a href={MIGRATION_FORM}>
                <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold px-8 py-6 shadow-xl shadow-[#F5B731]/25">
                  <ClipboardCheck className="w-4 h-4 mr-2" />
                  Pedir análise gratuita
                </Button>
              </a>
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-[#4BB678]" /> Análise sem compromisso</span>
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-[#4BB678]" /> Até 3 dias úteis</span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Tráfego pago */}
      <section id="trafego-pago" className="py-14 sm:py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Pixel pronto. <span className="text-[#F5B731]">CPL sob controle.</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Cada real investido em anúncio precisa virar lead rastreável.
              O EidosForm foi desenhado para isso.
            </p>
          </Reveal>

          <div className="grid sm:grid-cols-2 gap-5">
            {TRAFFIC_FEATURES.map(({ icon: Icon, color, title, desc }, i) => (
              <Reveal key={title} index={i} hoverLift className="group p-7 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-colors duration-300">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WhatsApp — notificação de lead + alerta de abandono (Plus). Bloco novo
          da auditoria LP 2026-07-28: a página dedicava UMA linha ao recurso
          mais forte pra tráfego pago. Mockup em CSS puro, sem imagem. */}
      <section id="whatsapp" className="py-12 sm:py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <Reveal>
            <Badge className="mb-4 bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20">
              <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
              No plano Plus
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-black mb-4 leading-tight">
              O lead cai no seu <span className="text-[#25D366]">WhatsApp</span>, com tudo
            </h2>
            <p className="text-slate-400 leading-relaxed mb-6">
              Cada novo lead chega no seu número com as respostas completas e um link
              pronto para respondê-lo em um toque. E se ele parar no meio, você recebe
              o alerta de lead incompleto — com o que ele já preencheu e a campanha de origem.
            </p>
            <ul className="space-y-2.5">
              {[
                'Respostas completas do lead, direto no seu número',
                'Alerta de lead abandonado: quem parou, onde parou e o que já preencheu',
                'Link wa.me pronto — responda o lead em um toque',
                'Campanha de origem (UTM) junto na mensagem',
              ].map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm sm:text-base text-slate-300 leading-relaxed">
                  <Check className="w-4 h-4 text-[#4BB678] mt-1 flex-shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal index={1} className="min-w-0">
            <div className="p-5 rounded-2xl bg-slate-900 border border-[#25D366]/20 ring-1 ring-[#25D366]/10 space-y-3">
              <div className="rounded-xl rounded-tl-sm bg-[#1F2C24] border border-[#25D366]/20 p-4 text-sm text-slate-200 leading-relaxed">
                <p className="font-bold text-[#25D366] mb-1.5">🔥 Novo lead em Captação — Mentoria</p>
                <p><span className="font-semibold">Nome:</span> Ana Souza</p>
                <p><span className="font-semibold">WhatsApp:</span> (11) 99999-0000</p>
                <p><span className="font-semibold">Investimento:</span> R$3.000 a R$5.000/mês</p>
                <p className="text-slate-400 text-xs mt-2">utm_campaign: lancamento-julho · Evento: LeadQualificado</p>
                <p className="text-[#25D366] text-xs font-semibold mt-2">💬 Responder: wa.me/5511999990000</p>
              </div>
              <div className="rounded-xl rounded-tl-sm bg-slate-800/80 border border-amber-400/20 p-4 text-sm text-slate-300 leading-relaxed">
                <p className="font-bold text-amber-400 mb-1">⚠️ Lead incompleto em Captação — Mentoria</p>
                <p className="text-slate-400 text-xs">Sem atividade há 30 min — parou na pergunta 4. Nome e WhatsApp já salvos.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Seções de ênfase: segmentação, marca, compartilhamento */}
      {EMPHASIS_SECTIONS.map(({ id, title, desc, bullets, mockup }, idx) => {
        const Mockup = SECTION_MOCKUPS[mockup]
        return (
          <section key={id} id={id} className={`py-12 sm:py-20 px-4 sm:px-6 ${idx % 2 ? 'bg-white/[0.02]' : ''}`}>
            <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
              <Reveal className={idx % 2 ? 'md:order-2' : ''}>
                <h2 className="text-2xl sm:text-4xl font-black mb-4 leading-tight">{title}</h2>
                <p className="text-slate-400 leading-relaxed mb-6">{desc}</p>
                <ul className="space-y-2.5">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 text-sm sm:text-base text-slate-300 leading-relaxed">
                      <Check className="w-4 h-4 text-[#4BB678] mt-1 flex-shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal index={1} className={idx % 2 ? 'min-w-0 md:order-1' : 'min-w-0'}>
                <Mockup />
              </Reveal>
            </div>
          </section>
        )
      })}

      {/* Compartilhe */}
      <section id="compartilhe" className="py-12 sm:py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-4xl font-black leading-tight">Publique onde o seu público está</h2>
          </Reveal>
          <div className="grid sm:grid-cols-3 gap-8 sm:gap-6">
            {SHARE_ITEMS.map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} index={i} className="text-center">
                <span className="inline-flex w-11 h-11 rounded-xl bg-[#F5B731]/10 items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-[#F5B731]" />
                </span>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Integrações */}
      <section className="py-14 sm:py-24 px-4 sm:px-6">
        <Reveal className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Conecte com o que você <span className="text-[#F5B731]">já usa</span>
          </h2>
          <p className="text-slate-400 text-lg mb-10 max-w-2xl mx-auto">
            Cada resposta vai para a sua planilha, seu CRM ou sua automação,
            por integração nativa ou webhook em tempo real.
          </p>

          <IntegrationsGrid />
        </Reveal>
      </section>

      {/* Agências → Professional */}
      <section id="agencias" className="py-14 sm:py-24 px-4 sm:px-6 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <Reveal>
            <Badge className="mb-4 bg-violet-500/10 text-violet-300 border border-violet-400/20">
              <Building2 className="w-3.5 h-3.5 mr-1.5" />
              Para agências
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-black mb-4 leading-tight">
              Um formulário com a marca de <span className="text-violet-300">cada cliente</span>
            </h2>
            <p className="text-slate-400 leading-relaxed mb-6">
              Entregue para o seu cliente um formulário que parece feito pela equipe dele:
              tema com a logo dele, domínio próprio e leads caindo direto no CRM dele.
              Tudo numa conta só, no plano Professional.
            </p>
            <Link href="/register?next=/checkout/professional&cycle=yearly">
              <Button size="lg" className="bg-violet-500 hover:bg-violet-400 text-white font-bold px-8 shadow-xl shadow-violet-500/25">
                Assinar Professional
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <p className="mt-3 text-sm text-slate-500">R$197/mês no plano anual · 15.000 respostas/mês</p>
          </Reveal>
          <Reveal index={1}>
            <div className="p-5 rounded-2xl bg-slate-900 border border-violet-400/20 ring-1 ring-violet-400/10 mb-5">
              <MockupAgency />
            </div>
            <ul className="space-y-2.5">
              {AGENCY_BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-slate-300 leading-relaxed">
                  <span className="w-5 h-5 min-w-5 rounded-md bg-violet-500/15 flex items-center justify-center mt-0.5">
                    <Check className="w-3 h-3 text-violet-300" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Depoimentos */}
      <TestimonialsSection />

      {/* Comparativo vs Typeform */}
      <section id="comparativo" className="py-14 sm:py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-10 sm:mb-14">
            <Badge className="mb-4 bg-white/5 text-slate-400 border border-white/10">EidosForm vs Typeform</Badge>
            <h2 className="text-3xl sm:text-5xl font-black mb-4">
              Mais respostas. <span className="text-[#F5B731]">Menos dólar.</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Compare plano a plano: no EidosForm, o mesmo orçamento compra muito mais resposta,
              e em real, sem IOF.
            </p>
          </Reveal>

          {/* Financeiro plano a plano */}
          <div className="grid sm:grid-cols-3 gap-5 mb-16">
            {FINANCIAL_COMPARISON.map(({ tier, eidos, typeform, ratio }, i) => (
              <Reveal key={tier} index={i} className="p-6 rounded-2xl bg-white/[0.04] border border-white/5 flex flex-col">
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
              </Reveal>
            ))}
          </div>

          {/* Tabela de recursos */}
          <Reveal className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-slate-900 border-b border-white/10 text-xs sm:text-sm font-bold">
              <div className="px-4 sm:px-6 py-4 text-slate-400 uppercase tracking-wider text-xs">Recurso</div>
              <div className="px-2 sm:px-4 py-4 text-[#F5B731] text-center bg-[#F5B731]/[0.07]">EidosForm</div>
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
                <div className="px-2 sm:px-4 py-4 bg-[#F5B731]/[0.07]"><ComparisonCell value={row.eidos} /></div>
                <div className="px-2 sm:px-4 py-4"><ComparisonCell value={row.typeform} /></div>
              </div>
            ))}
          </Reveal>
          <p className="mt-4 text-xs text-slate-600 text-center">
            Preços do Typeform conforme typeform.com/pricing em junho/2026 (cobrança anual),
            convertidos a R$5,00/US$. Com câmbio do dia e IOF, a diferença é ainda maior.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <PricingSectionV3 />

      {/* FAQ */}
      <section id="faq" className="py-14 sm:py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
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
      <section className="py-14 sm:py-24 px-4 sm:px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#F5B731]/3 to-transparent pointer-events-none" />
        <Reveal className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-black mb-4">
            Seu próximo lead está a um formulário de distância
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Crie o primeiro grátis, em minutos. Se as pessoas responderem mais, você fica.
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-[#F5B731] hover:bg-[#E8923A] text-black font-bold text-lg px-10 py-6 shadow-xl shadow-[#F5B731]/25 transition-all hover:shadow-[#E8923A]/35 hover:-translate-y-0.5">
              Criar meu primeiro formulário grátis
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="mt-4 text-sm text-slate-500">Grátis até 100 respostas/mês · Sem cartão de crédito</p>
        </Reveal>
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
            <div className="hidden sm:block">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Produto</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#trafego-pago" className="hover:text-white transition-colors inline-block py-1">Tráfego pago</a></li>
                <li><a href="#comparativo" className="hover:text-white transition-colors inline-block py-1">vs Typeform</a></li>
                <li><a href="#precos" className="hover:text-white transition-colors inline-block py-1">Preços</a></li>
                <li><Link href="/login" className="hover:text-white transition-colors inline-block py-1">Painel</Link></li>
              </ul>
            </div>
            <div className="hidden sm:block">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Suporte</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><a href="#faq" className="hover:text-white transition-colors inline-block py-1">FAQ</a></li>
                <li><a href="https://wa.me/5583999378937" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors inline-block py-1">Contato</a></li>
                <li><a href={MIGRATION_FORM} className="hover:text-white transition-colors inline-block py-1">Migração gratuita</a></li>
              </ul>
            </div>
            <div className="hidden sm:block">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Legal</h4>
              <ul className="space-y-1 text-sm text-slate-500">
                <li><Link href="/privacidade" className="hover:text-white transition-colors inline-block py-1">Privacidade</Link></li>
                <li><Link href="/termos" className="hover:text-white transition-colors inline-block py-1">Termos de uso</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-600">© 2026 EidosForm. Todos os direitos reservados.</p>
            <div className="flex items-center gap-4 text-xs text-slate-600 sm:hidden">
              <Link href="/privacidade" className="hover:text-white transition-colors">Privacidade</Link>
              <Link href="/termos" className="hover:text-white transition-colors">Termos de uso</Link>
            </div>
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
