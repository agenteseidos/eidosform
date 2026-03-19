import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">404</h1>
        <p className="text-xl text-slate-400 mb-8">Página não encontrada</p>
        <Link
          href="/"
          className="inline-flex items-center px-6 py-3 rounded-lg bg-gradient-to-r from-[#F5B731] to-[#E8923A] text-black font-semibold hover:opacity-90 transition-opacity"
        >
          Voltar para o início
        </Link>
      </div>
    </div>
  )
}
