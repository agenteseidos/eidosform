import Link from 'next/link'
import { FileText, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-black">Política de Privacidade</h1>
        </div>

        <div className="prose prose-invert prose-slate max-w-none space-y-6 text-slate-300">
          <p className="text-slate-400 text-sm">Última atualização: março de 2026</p>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Coleta de dados</h2>
            <p>O EidosForm coleta apenas os dados necessários para o funcionamento do serviço: endereço de e-mail para autenticação e as respostas dos formulários criados pelos usuários.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Uso dos dados</h2>
            <p>Os dados coletados são usados exclusivamente para fornecer o serviço. Não vendemos nem compartilhamos seus dados com terceiros para fins comerciais.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Segurança</h2>
            <p>Todos os dados são criptografados em trânsito (TLS 1.3) e em repouso (AES-256). Seguimos as melhores práticas de segurança da indústria.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. LGPD</h2>
            <p>Você tem direito a acessar, corrigir e excluir seus dados a qualquer momento. Para exercer esses direitos, entre em contato: <a href="mailto:privacidade@eidosform.com" className="text-[#F5B731] hover:underline">privacidade@eidosform.com</a></p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Contato</h2>
            <p>Dúvidas sobre privacidade? <a href="mailto:suporte@eidosform.com" className="text-[#F5B731] hover:underline">suporte@eidosform.com</a></p>
          </section>
        </div>
      </div>
    </div>
  )
}
