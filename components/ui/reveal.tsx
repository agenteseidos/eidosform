'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

// Entrada por scroll das landings (/v3 e /v4).
// Regras do motion Eidos (references/motion.md):
//   • só transform/opacity (compõe na GPU, zero reflow, zero CLS)
//   • o hero NUNCA anima — é o elemento de LCP
//   • anima uma vez só (once) e o estado inicial já ocupa o espaço final
//   • prefers-reduced-motion deixa tudo visível e estático
//
// Uso: substitui a <div> que já existia, herdando o mesmo className —
// assim o layout não muda, só ganha a entrada.
export function Reveal({
  children,
  className,
  index = 0,
  hoverLift = false,
}: {
  children: ReactNode
  className?: string
  /** Posição no conjunto: escalona a entrada em 70ms, com teto de 6 itens. */
  index?: number
  /**
   * Levanta o card no hover. Precisa ser feito aqui, e não com
   * `hover:-translate-y` do Tailwind: o motion deixa `transform` inline no
   * elemento e o inline vence a classe, matando o hover silenciosamente.
   */
  hoverLift?: boolean
}) {
  const reduce = useReducedMotion()

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={
        hoverLift && !reduce
          ? { y: -3, transition: { duration: 0.18, ease: 'easeOut' } }
          : undefined
      }
      viewport={{ once: true, amount: 'some' }}
      transition={{
        duration: 0.42,
        delay: Math.min(index, 5) * 0.07,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  )
}
