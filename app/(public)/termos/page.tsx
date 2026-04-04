import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EidosLogo } from '@/components/ui/eidos-logo'

export const metadata = {
  title: 'Termos de Uso — EidosForm',
  description: 'Leia os Termos de Uso do EidosForm antes de utilizar a plataforma.',
}

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <EidosLogo variant="reduced" theme="dark" href="/" height={34} />
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-white/10">
              Entrar
            </Button>
          </Link>
        </div>
      </nav>

      <div className="pt-28 pb-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white mb-8 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
          </Link>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F5B731] to-[#E8923A] flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black">Termos de Uso</h1>
          </div>

          <p className="text-slate-400 text-sm mb-10">
            Última atualização: 02 de abril de 2026
          </p>

          <div className="prose prose-invert prose-slate max-w-none space-y-10 text-slate-300 leading-relaxed">

            {/* Intro */}
            <section>
              <p>
                Estes Termos de Uso (&quot;Termos&quot;) regulam o acesso e o uso da plataforma <strong className="text-white">EidosForm</strong>, operada pela <strong className="text-white">Eidos Tecnologia Ltda.</strong> (&quot;Eidos&quot;), CNPJ 00.000.000/0001-00, com sede em Recife/PE. Ao criar uma conta ou utilizar o EidosForm, você (&quot;Usuário&quot;) concorda com estes Termos integralmente.
              </p>
              <p className="mt-4">
                Se você utiliza o EidosForm em nome de uma empresa ou organização, declara ter poderes para vinculá-la a estes Termos.
              </p>
            </section>

            {/* 1. Descrição do serviço */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">1. Descrição do Serviço</h2>
              <p className="text-slate-400">
                O EidosForm é uma plataforma SaaS (Software as a Service) para criação de formulários conversacionais, coleta de respostas, análise de dados e integração com ferramentas de marketing (Meta Pixel, Google Ads/GTM, TikTok Pixel), validação de dados brasileiros (CPF, CNPJ, CEP), processamento de pagamentos em Real (BRL) e integrações com Google Sheets e webhooks.
              </p>
              <p className="mt-3 text-slate-400">
                A Eidos se reserva o direito de modificar, suspender ou descontinuar funcionalidades do serviço a qualquer tempo, comunicando os usuários com antecedência razoável nos casos de mudanças relevantes.
              </p>
            </section>

            {/* 2. Planos e preços */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">2. Planos e Preços</h2>
              <p className="text-slate-400">O EidosForm oferece os seguintes planos (valores sujeitos a atualização periódica):</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li><strong className="text-slate-200">Free:</strong> gratuito para sempre, até 3 formulários e 100 respostas/mês. Sem necessidade de cartão de crédito.</li>
                <li><strong className="text-slate-200">Plus:</strong> cobrança mensal ou anual; inclui mais formulários, respostas ilimitadas, pixels de rastreamento, notificações e sem marca d&apos;água.</li>
                <li><strong className="text-slate-200">Professional:</strong> todas as funcionalidades do Plus, mais API REST, domínio personalizado, Google Sheets e suporte prioritário.</li>
              </ul>
              <p className="mt-4 text-slate-400">
                Os preços atualizados estão sempre disponíveis na <Link href="/#precos" className="text-[#F5B731] hover:underline">página de preços</Link>. Assinaturas anuais são cobradas integralmente no ato da contratação.
              </p>
            </section>

            {/* 3. Cancelamento */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">3. Cancelamento e Downgrade</h2>
              <p className="text-slate-400">
                Você pode cancelar sua assinatura a qualquer momento, diretamente pelo painel em <strong className="text-white">Configurações → Plano</strong>, sem burocracia, sem necessidade de entrar em contato com suporte, e sem multas ou taxas de cancelamento.
              </p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li>O acesso ao plano pago continua ativo até o fim do período já cobrado.</li>
                <li>Após o vencimento, a conta migra automaticamente para o plano Free.</li>
                <li>Seus dados (formulários e respostas) ficam disponíveis para exportação por até <strong className="text-slate-200">30 dias</strong> após o cancelamento, em formatos abertos (CSV/JSON).</li>
                <li>Após esse período, os dados poderão ser excluídos conforme a Política de Privacidade.</li>
              </ul>
            </section>

            {/* 4. Direito de arrependimento */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">4. Direito de Arrependimento</h2>
              <p className="text-slate-400">
                Nos termos do art. 49 do <strong className="text-white">Código de Defesa do Consumidor (Lei nº 8.078/1990)</strong>, o consumidor que contratar um plano anual por meio eletrônico tem direito ao arrependimento e ao reembolso integral, desde que o exercício se dê no prazo de <strong className="text-white">7 (sete) dias corridos</strong> a contar da data da contratação.
              </p>
              <p className="mt-3 text-slate-400">
                Para solicitar o arrependimento, envie um e-mail para <a href="mailto:suporte@eidosform.com.br" className="text-[#F5B731] hover:underline">suporte@eidosform.com.br</a> com o assunto &quot;Arrependimento — Plano Anual&quot;. O reembolso será processado pelo mesmo meio de pagamento utilizado na contratação em até 7 dias úteis.
              </p>
              <p className="mt-3 text-slate-400">
                Para planos mensais, não há reembolso proporcional ao período não utilizado, mas o cancelamento interrompe a renovação imediata.
              </p>
            </section>

            {/* 5. Responsabilidades do usuário */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">5. Responsabilidades do Usuário</h2>
              <p className="text-slate-400">O Usuário é responsável por:</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li>Manter a confidencialidade de suas credenciais de acesso.</li>
                <li>Todo o conteúdo publicado nos formulários criados na Plataforma.</li>
                <li><strong className="text-slate-200">Uso de pixels e rastreadores:</strong> ao habilitar Meta Pixel, Google Ads/GTM, TikTok Pixel ou qualquer outro rastreador em seus formulários, o Usuário assume inteira responsabilidade por (i) obter o consentimento explícito dos respondentes para coleta e tratamento de dados para fins publicitários, conforme a LGPD; (ii) inserir as informações corretas na política de privacidade própria; e (iii) cumprir os Termos de Serviço da plataforma de anúncios correspondente.</li>
                <li>Não utilizar a Plataforma para fins ilegais, fraudulentos ou que violem direitos de terceiros.</li>
                <li>Não realizar engenharia reversa, scraping massivo ou tentativas de comprometer a segurança da Plataforma.</li>
                <li>Cumprir a LGPD na qualidade de controlador dos dados dos respondentes de seus formulários.</li>
              </ul>
            </section>

            {/* 6. Limitação de responsabilidade */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">6. SLA e Disponibilidade</h2>
              <p className="text-slate-400">
                A Eidos envida os melhores esforços para manter o EidosForm disponível <strong className="text-white">24 horas por dia, 7 dias por semana</strong>, com meta de disponibilidade de <strong className="text-white">99,5%</strong> mensais (excluídas janelas de manutenção programada, comunicadas com ao menos 24h de antecedência).
              </p>
              <p className="mt-3 text-slate-400">
                A Eidos não se responsabiliza por:
              </p>
              <ul className="list-disc list-inside space-y-2 mt-2 text-slate-400">
                <li>Indisponibilidade causada por terceiros (provedores de infraestrutura, operadoras de rede, fornecedores de pixels).</li>
                <li>Perda de dados causada por ação do próprio Usuário ou de terceiros não autorizados por falha do Usuário.</li>
                <li>Danos indiretos, lucros cessantes ou danos morais decorrentes de uso inadequado da Plataforma.</li>
              </ul>
              <p className="mt-3 text-slate-400">
                A responsabilidade total da Eidos ficará limitada ao valor pago pelo Usuário nos últimos 12 meses.
              </p>
            </section>

            {/* 7. Propriedade intelectual */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">7. Propriedade Intelectual</h2>
              <p className="text-slate-400">
                Todo o software, design, marca e documentação do EidosForm são propriedade da Eidos ou de seus licenciadores. A assinatura de um plano concede ao Usuário uma licença de uso não exclusiva, intransferível e revogável, para fins lícitos, enquanto a conta estiver ativa.
              </p>
              <p className="mt-3 text-slate-400">
                O Usuário mantém todos os direitos sobre o conteúdo dos formulários e sobre os dados coletados por meio deles.
              </p>
            </section>

            {/* 8. LGPD */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">8. Proteção de Dados (LGPD)</h2>
              <p className="text-slate-400">
                O tratamento de dados pessoais pela Eidos está detalhado na <Link href="/privacidade" className="text-[#F5B731] hover:underline">Política de Privacidade</Link>, que é parte integrante destes Termos. O Usuário, ao criar formulários que coletam dados de respondentes, assume a condição de <strong className="text-white">controlador</strong> nos termos da LGPD, sendo a Eidos <strong className="text-white">operadora</strong>. As obrigações de informar, obter consentimento e atender direitos dos titulares recaem sobre o Usuário nessa relação.
              </p>
            </section>

            {/* 9. Vigência e rescisão */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">9. Vigência e Rescisão</h2>
              <p className="text-slate-400">
                Estes Termos vigoram enquanto o Usuário mantiver uma conta ativa. A Eidos pode suspender ou encerrar contas que violem estes Termos, com aviso prévio de <strong className="text-white">48 horas</strong> sempre que possível (salvo em casos de uso fraudulento ou ilegal, que admitem encerramento imediato).
              </p>
            </section>

            {/* 10. Foro */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">10. Legislação Aplicável e Foro</h2>
              <p className="text-slate-400">
                Estes Termos são regidos pela legislação brasileira. Eventuais disputas serão submetidas ao foro da <strong className="text-white">Comarca de Recife, Estado de Pernambuco</strong>, com exclusão de qualquer outro, por mais privilegiado que seja, ressalvado o disposto no art. 101, I do Código de Defesa do Consumidor para relações de consumo.
              </p>
            </section>

            {/* 11. Alterações */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">11. Alterações nestes Termos</h2>
              <p className="text-slate-400">
                A Eidos pode alterar estes Termos a qualquer momento. Mudanças relevantes serão comunicadas por e-mail e/ou aviso na Plataforma com pelo menos <strong className="text-white">10 dias de antecedência</strong>. O uso continuado após a entrada em vigor das alterações implica aceitação dos novos Termos.
              </p>
            </section>

            {/* 12. Contato */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">12. Contato</h2>
              <p className="text-slate-400">
                Dúvidas sobre estes Termos podem ser enviadas para <a href="mailto:suporte@eidosform.com.br" className="text-[#F5B731] hover:underline">suporte@eidosform.com.br</a>.
              </p>
            </section>

          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-600">© 2026 EidosForm. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <Link href="/privacidade" className="hover:text-white transition-colors">Privacidade</Link>
            <Link href="/termos" className="text-[#F5B731]">Termos de uso</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
