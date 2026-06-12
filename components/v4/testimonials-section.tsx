import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Quote } from 'lucide-react'

// ─── DEPOIMENTOS (v4, fundo branco) ───────────────────────────────────────────
// 5 espaços reservados. Para publicar:
//   1. Salve as fotos em public/depoimentos/ (ex.: public/depoimentos/maria.jpg)
//   2. Preencha photo com o caminho (ex.: '/depoimentos/maria.jpg')
//   3. Substitua quote pelo texto real — MÁXIMO ~250 caracteres
// Enquanto photo for null, o card mostra um avatar com as iniciais.

interface Testimonial {
  name: string
  role: string
  photo: string | null
  quote: string
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Nome da Pessoa 1',
    role: 'Profissão · Empresa',
    photo: null,
    quote:
      '[Espaço reservado — depoimento 1, até 250 caracteres. Ideal: resultado concreto, ex.: "Troquei meu formulário antigo pelo EidosForm e a taxa de conclusão dobrou já na primeira semana."]',
  },
  {
    name: 'Nome da Pessoa 2',
    role: 'Profissão · Empresa',
    photo: null,
    quote:
      '[Espaço reservado — depoimento 2, até 250 caracteres. Ideal: citar um recurso específico, ex.: validação de CPF, respostas parciais, Pixel nativo.]',
  },
  {
    name: 'Nome da Pessoa 3',
    role: 'Profissão · Empresa',
    photo: null,
    quote:
      '[Espaço reservado — depoimento 3, até 250 caracteres. Ideal: comparação com a ferramenta anterior ou economia de tempo/dinheiro.]',
  },
  {
    name: 'Nome da Pessoa 4',
    role: 'Profissão · Empresa',
    photo: null,
    quote:
      '[Espaço reservado — depoimento 4, até 250 caracteres. Ideal: experiência de quem responde ("meus clientes elogiam o formulário").]',
  },
  {
    name: 'Nome da Pessoa 5',
    role: 'Profissão · Empresa',
    photo: null,
    quote:
      '[Espaço reservado — depoimento 5, até 250 caracteres. Ideal: facilidade de uso ("publiquei em minutos, sem ajuda técnica").]',
  },
]

const AVATAR_GRADIENTS = [
  'from-[#F5B731] to-[#E8923A]',
  'from-blue-500 to-cyan-500',
  'from-violet-500 to-purple-600',
  'from-emerald-400 to-teal-500',
  'from-pink-500 to-rose-500',
]

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

function TestimonialCard({ t, index }: { t: Testimonial; index: number }) {
  return (
    <figure className="flex flex-col p-6 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      {/* Foto ao lado do nome; depoimento abaixo */}
      <div className="flex items-center gap-3 mb-4">
        {t.photo ? (
          <Image
            src={t.photo}
            alt={`Foto de ${t.name}`}
            width={52}
            height={52}
            className="w-13 h-13 rounded-full object-cover border-2 border-[#F5B731]/50"
          />
        ) : (
          <div
            className={`w-13 h-13 min-w-13 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length]} flex items-center justify-center text-white font-bold text-lg border-2 border-white shadow`}
            aria-hidden
          >
            {initials(t.name)}
          </div>
        )}
        <figcaption>
          <p className="font-bold text-slate-900 text-sm">{t.name}</p>
          <p className="text-xs text-slate-500">{t.role}</p>
        </figcaption>
      </div>
      <Quote className="w-4 h-4 text-[#E8923A] mb-2" aria-hidden />
      <blockquote className="text-sm text-slate-700 leading-relaxed">
        {t.quote}
      </blockquote>
    </figure>
  )
}

export function TestimonialsSection() {
  return (
    <section id="depoimentos" className="py-24 px-4 sm:px-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <Badge className="mb-4 bg-slate-100 text-slate-600 border border-slate-200">
            Depoimentos
          </Badge>
          <h2 className="text-3xl sm:text-5xl font-black mb-4 text-slate-900">
            Quem usa, <span className="text-[#E8923A]">recomenda</span>
          </h2>
          <p className="text-slate-600 text-lg max-w-xl mx-auto">
            Histórias reais de quem trocou formulários chatos por conversas que convertem.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TESTIMONIALS.slice(0, 3).map((t, i) => (
            <TestimonialCard key={t.name} t={t} index={i} />
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-5 mt-5 lg:max-w-[66%] lg:mx-auto">
          {TESTIMONIALS.slice(3).map((t, i) => (
            <TestimonialCard key={t.name} t={t} index={i + 3} />
          ))}
        </div>
      </div>
    </section>
  )
}
