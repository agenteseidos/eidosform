'use client'

import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Conteúdo exibido no lugar quando o render dos filhos lança. Recebe o erro e uma função de reset. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
  /** Rótulo opcional usado no log de erro (ajuda a identificar a origem no console). */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Error boundary genérico para isolar uma subárvore do React.
 *
 * Uso típico: envolver áreas que renderizam conteúdo dirigido por dados do usuário
 * (ex.: preview de uma pergunta, painel de propriedades) para que uma única pergunta
 * malformada não derrube a página inteira. Passe um `key` que mude por item
 * (ex.: id da pergunta) para que a boundary se remonte e recupere ao trocar de item.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div className="p-6 text-sm text-slate-500">
          Não foi possível exibir este conteúdo.
        </div>
      )
    }
    return this.props.children
  }
}
