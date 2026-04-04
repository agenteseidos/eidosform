import Link from 'next/link'
import { ArrowLeft, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EidosLogo } from '@/components/ui/eidos-logo'

export const metadata = {
  title: 'Política de Privacidade — EidosForm',
  description: 'Saiba como o EidosForm coleta, usa e protege seus dados pessoais, em conformidade com a LGPD.',
}

export default function PrivacidadePage() {
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
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black">Política de Privacidade</h1>
          </div>

          <p className="text-slate-400 text-sm mb-10">
            Última atualização: 02 de abril de 2026
          </p>

          <div className="prose prose-invert prose-slate max-w-none space-y-10 text-slate-300 leading-relaxed">

            {/* Intro */}
            <section>
              <p>
                A <strong className="text-white">Eidos Tecnologia Ltda.</strong> (&quot;Eidos&quot;, &quot;nós&quot; ou &quot;nosso&quot;), CNPJ 00.000.000/0001-00, com sede em Recife/PE, é a controladora dos dados pessoais tratados no âmbito do serviço <strong className="text-white">EidosForm</strong> (doravante &quot;Plataforma&quot;). Esta Política de Privacidade descreve como coletamos, usamos, compartilhamos e protegemos seus dados, em conformidade com a <strong className="text-white">Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD)</strong>.
              </p>
              <p className="mt-4">
                Ao criar uma conta ou utilizar a Plataforma, você declara ter lido e concordar com os termos desta Política.
              </p>
            </section>

            {/* 1. Dados coletados */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">1. Dados Pessoais Coletados</h2>
              <p>Coletamos as seguintes categorias de dados:</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li><strong className="text-slate-200">Dados de cadastro:</strong> nome, endereço de e-mail, senha (armazenada em hash bcrypt), número de telefone (opcional).</li>
                <li><strong className="text-slate-200">Dados de faturamento:</strong> CPF/CNPJ, dados de cartão de crédito tokenizados (processados pelo Asaas — nunca armazenamos o número completo do cartão).</li>
                <li><strong className="text-slate-200">Dados de uso:</strong> formulários criados, respostas coletadas, logs de acesso (IP, user-agent, timestamp), eventos de pixel configurados pelo usuário.</li>
                <li><strong className="text-slate-200">Dados de respondentes:</strong> quaisquer informações inseridas nos formulários criados pelos nossos clientes. O cliente (usuário da Plataforma) é o controlador dessas informações; a Eidos atua como operadora.</li>
                <li><strong className="text-slate-200">Cookies e dados técnicos:</strong> detalhados na Seção 2.</li>
              </ul>
            </section>

            {/* 2. Cookies e rastreamento */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">2. Cookies e Tecnologias de Rastreamento</h2>
              <p>Usamos cookies e tecnologias semelhantes para garantir o funcionamento da Plataforma, autenticar sessões e melhorar a experiência:</p>

              <h3 className="text-base font-semibold text-slate-200 mt-5 mb-2">2.1 Cookies essenciais</h3>
              <p className="text-slate-400">Necessários para autenticação e segurança da sessão. Não podem ser desativados sem comprometer o serviço.</p>

              <h3 className="text-base font-semibold text-slate-200 mt-5 mb-2">2.2 Cookies analíticos</h3>
              <p className="text-slate-400">Utilizamos ferramentas de análise para entender como os usuários interagem com a Plataforma. Os dados são agregados e anonimizados sempre que possível.</p>

              <h3 className="text-base font-semibold text-slate-200 mt-5 mb-2">2.3 Pixels de rastreamento de terceiros (configurados pelo cliente)</h3>
              <p className="text-slate-400">
                A Plataforma permite que clientes integrem os seguintes pixels de rastreamento em seus formulários públicos:
              </p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li>
                  <strong className="text-slate-200">Meta Pixel (Facebook Ads):</strong> código JavaScript fornecido pela Meta Platforms Inc., que coleta dados de comportamento do respondente para mensuração de campanhas. O ID do pixel é de responsabilidade exclusiva do cliente que o configurou. Consulte a <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">Política de Dados da Meta</a>.
                </li>
                <li>
                  <strong className="text-slate-200">Google Ads / Google Tag Manager (GTM):</strong> permite ao cliente disparar tags de conversão e remarketing do Google. Os dados coletados pelo GTM são regidos pela <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">Política de Privacidade do Google</a>.
                </li>
                <li>
                  <strong className="text-slate-200">TikTok Pixel:</strong> código fornecido pela TikTok Inc. para mensuração de conversões em campanhas no TikTok Ads. Regido pela <a href="https://www.tiktok.com/legal/page/global/privacy-policy/pt-BR" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">Política de Privacidade do TikTok</a>.
                </li>
              </ul>
              <p className="text-slate-400 mt-4">
                <strong className="text-slate-200">Atenção:</strong> a Eidos não controla os dados coletados pelos pixels de terceiros, tampouco os algoritmos de segmentação dessas plataformas. O cliente que ativa esses pixels é o único responsável por obter o consentimento dos respondentes e por cumprir as exigências legais aplicáveis (LGPD, GDPR, etc.).
              </p>
              <p className="text-slate-400 mt-3">
                Para gerenciar preferências de cookies no seu navegador, consulte o menu de configurações do navegador ou ferramentas como <a href="https://optout.aboutads.info/" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">optout.aboutads.info</a>.
              </p>
            </section>

            {/* 3. Finalidade do tratamento */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">3. Finalidade e Base Legal do Tratamento</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 pr-4 text-slate-300 font-semibold">Finalidade</th>
                      <th className="text-left py-2 pr-4 text-slate-300 font-semibold">Base Legal (LGPD)</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-400">
                    <tr className="border-b border-white/5">
                      <td className="py-2 pr-4">Criação e gerenciamento de conta</td>
                      <td className="py-2">Execução de contrato (art. 7º, V)</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 pr-4">Processamento de pagamentos</td>
                      <td className="py-2">Execução de contrato (art. 7º, V)</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 pr-4">Envio de e-mails transacionais e de suporte</td>
                      <td className="py-2">Execução de contrato (art. 7º, V)</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 pr-4">Marketing e comunicados sobre o serviço</td>
                      <td className="py-2">Legítimo interesse (art. 7º, IX) / Consentimento (art. 7º, I)</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 pr-4">Análise e melhoria da Plataforma</td>
                      <td className="py-2">Legítimo interesse (art. 7º, IX)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Cumprimento de obrigações legais e fiscais</td>
                      <td className="py-2">Obrigação legal (art. 7º, II)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. Segurança */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">4. Segurança dos Dados</h2>
              <p>Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado, alteração, divulgação ou destruição:</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li><strong className="text-slate-200">TLS 1.3:</strong> todas as comunicações entre seu navegador e os servidores da Eidos são criptografadas em trânsito.</li>
                <li><strong className="text-slate-200">Criptografia em repouso:</strong> dados em banco (Supabase/PostgreSQL) são protegidos com criptografia AES-256 no nível de armazenamento.</li>
                <li><strong className="text-slate-200">Senhas:</strong> armazenadas exclusivamente como hash bcrypt, impossibilitando recuperação em texto claro.</li>
                <li><strong className="text-slate-200">Controle de acesso:</strong> princípio do menor privilégio aplicado a todos os colaboradores e sistemas internos.</li>
                <li><strong className="text-slate-200">Monitoramento:</strong> alertas automáticos para atividades suspeitas e auditorias periódicas de segurança.</li>
              </ul>
              <p className="text-slate-400 mt-4">
                Em caso de incidente de segurança que possa afetar seus dados, você será notificado no prazo estabelecido pela LGPD e pelas normas da ANPD.
              </p>
            </section>

            {/* 5. Compartilhamento */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">5. Compartilhamento de Dados</h2>
              <p>Não vendemos seus dados pessoais. Podemos compartilhá-los com:</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li><strong className="text-slate-200">Asaas:</strong> processador de pagamentos, para cobrança de assinaturas.</li>
                <li><strong className="text-slate-200">Supabase:</strong> banco de dados e autenticação, hospedado em servidores na região brasil.</li>
                <li><strong className="text-slate-200">Vercel / provedores de infraestrutura:</strong> hospedagem da aplicação.</li>
                <li><strong className="text-slate-200">Autoridades e órgãos governamentais:</strong> quando exigido por lei ou por ordem judicial.</li>
              </ul>
              <p className="text-slate-400 mt-4">
                Todos os fornecedores terceiros são contratualmente obrigados a tratar os dados apenas para a finalidade específica e a adotar medidas de segurança adequadas.
              </p>
            </section>

            {/* 6. Retenção */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">6. Retenção de Dados</h2>
              <ul className="list-disc list-inside space-y-2 text-slate-400">
                <li>Dados de conta: mantidos enquanto a conta estiver ativa.</li>
                <li>Após exclusão da conta: dados pessoais são anonimizados ou deletados em até <strong className="text-slate-200">30 dias</strong>, ressalvadas obrigações legais (ex: dados fiscais retidos por 5 anos conforme legislação tributária).</li>
                <li>Logs de acesso: retidos por 6 meses conforme o Marco Civil da Internet (Lei nº 12.965/2014).</li>
                <li>Respostas de formulários: retidas enquanto o formulário existir na plataforma ou conforme configuração do cliente. O titular pode solicitar exclusão ao cliente (controlador dos dados do formulário).</li>
              </ul>
            </section>

            {/* 7. Direitos do titular */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">7. Direitos do Titular (LGPD)</h2>
              <p>Nos termos dos arts. 17 a 22 da LGPD, você tem direito a:</p>
              <ul className="list-disc list-inside space-y-2 mt-3 text-slate-400">
                <li><strong className="text-slate-200">Confirmação e acesso:</strong> saber se tratamos seus dados e obter uma cópia.</li>
                <li><strong className="text-slate-200">Correção/Retificação:</strong> solicitar a atualização de dados incompletos, inexatos ou desatualizados.</li>
                <li><strong className="text-slate-200">Anonimização, bloqueio ou eliminação:</strong> de dados desnecessários ou tratados em desconformidade com a LGPD.</li>
                <li><strong className="text-slate-200">Portabilidade:</strong> receber seus dados em formato estruturado e interoperável (ex: CSV/JSON).</li>
                <li><strong className="text-slate-200">Eliminação/Exclusão:</strong> requerer a exclusão dos dados tratados com base no consentimento.</li>
                <li><strong className="text-slate-200">Revogação do consentimento:</strong> retirar o consentimento a qualquer momento, sem prejuízo das operações realizadas anteriormente.</li>
                <li><strong className="text-slate-200">Informação sobre compartilhamento:</strong> saber com quais entidades públicas e privadas seus dados foram compartilhados.</li>
                <li><strong className="text-slate-200">Oposição:</strong> se opor ao tratamento realizado com base em legítimo interesse.</li>
              </ul>
              <p className="text-slate-400 mt-4">
                Para exercer seus direitos, envie um e-mail para <a href="mailto:privacidade@eidosform.com.br" className="text-[#F5B731] hover:underline">privacidade@eidosform.com.br</a> com o assunto &quot;Direitos LGPD&quot;. Responderemos em até 15 dias úteis.
              </p>
            </section>

            {/* 8. DPO */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">8. Encarregado de Dados (DPO)</h2>
              <p className="text-slate-400">
                Nos termos do art. 41 da LGPD, o Encarregado de Proteção de Dados da Eidos pode ser contatado pelo e-mail: <a href="mailto:dpo@eidosform.com.br" className="text-[#F5B731] hover:underline">dpo@eidosform.com.br</a>.
              </p>
            </section>

            {/* 9. ANPD */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">9. Canal de Reclamação — ANPD</h2>
              <p className="text-slate-400">
                Se você considerar que seu pedido de exercício de direitos não foi atendido adequadamente, você pode registrar uma reclamação junto à <strong className="text-white">Autoridade Nacional de Proteção de Dados (ANPD)</strong> por meio do portal <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" className="text-[#F5B731] hover:underline">www.gov.br/anpd</a>.
              </p>
            </section>

            {/* 10. Alterações */}
            <section>
              <h2 className="text-xl font-bold text-white mb-4">10. Alterações nesta Política</h2>
              <p className="text-slate-400">
                Podemos atualizar esta Política periodicamente. Quando fizermos alterações relevantes, notificaremos por e-mail e/ou por aviso na Plataforma com pelo menos 10 dias de antecedência. A data da última atualização está sempre no topo deste documento.
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
            <Link href="/privacidade" className="text-[#F5B731]">Privacidade</Link>
            <Link href="/termos" className="hover:text-white transition-colors">Termos de uso</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
