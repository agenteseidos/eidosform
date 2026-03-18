import Link from 'next/link'
import { FileText, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white px-4 sm:px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F5B731] to-[#E8923A] flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-3xl font-black">Termos de Uso</h1>
        </div>

        <div className="prose prose-invert prose-slate max-w-none space-y-6 text-slate-300">
          <p className="text-slate-400 text-sm">Última atualização: março de 2026</p>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Aceitação</h2>
            <p>Ao usar o EidosForm, você concorda com estes Termos de Uso. Se não concordar, não utilize o serviço.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Uso permitido</h2>
            <p>O EidosForm pode ser usado para coletar dados legítimos. É proibido usar o serviço para spam, phishing, coleta ilegal de dados ou qualquer atividade ilegal.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Planos e pagamentos</h2>
            <p>Os planos pagos são cobrados mensalmente ou anualmente conforme escolha do usuário. O cancelamento pode ser feito a qualquer momento pelo painel.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Responsabilidade</h2>
            <p>O EidosForm não se responsabiliza pelo conteúdo dos formulários criados pelos usuários. Cada usuário é responsável pelo uso adequado da plataforma.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Alterações</h2>
            <p>Podemos atualizar estes termos a qualquer momento. Notificaremos usuários por e-mail em caso de mudanças significativas.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Contato</h2>
            <p>Dúvidas? <a href="mailto:suporte@eidosform.com" className="text-[#F5B731] hover:underline">suporte@eidosform.com</a></p>
          </section>
        </div>
      </div>
    </div>
  )
}
