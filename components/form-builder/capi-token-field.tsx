'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { CheckCircle2, AlertTriangle, Loader2, Trash2, ExternalLink } from 'lucide-react'

/**
 * O campo do token da API de Conversões — o par do Pixel ID (18/08/2026).
 *
 * POR QUE ELE NÃO ENTRA NO AUTOSAVE DO CONSTRUTOR: o construtor salva o formulário inteiro e o
 * servidor DEVOLVE o que gravou, para manter a tela em sincronia. Um token nesse pacote voltaria
 * ao navegador a cada save. Credencial não faz viagem de volta — por isso este campo tem rota
 * própria (`/api/forms/[id]/capi-token`) e o que retorna é só a dica ("••••ab12").
 *
 * É por isso também que o campo fica VAZIO quando já existe token: não há o que preencher, porque
 * o valor nunca sai do servidor. Trocar = colar um novo por cima.
 */

type Estado = {
  configurado: boolean
  dica?: string | null
  validadoEm?: string | null
  pixelDivergente?: boolean
}

export function CapiTokenField({ formId, pixelAtual }: { formId: string; pixelAtual: string }) {
  const temPixel = Boolean(pixelAtual.trim())
  const [estado, setEstado] = useState<Estado | null>(null)
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/forms/${formId}/capi-token`)
      if (!r.ok) { setEstado({ configurado: false }); return }
      setEstado(await r.json())
    } catch {
      setEstado({ configurado: false })
    }
  }, [formId])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    const token = valor.trim()
    if (!token) return
    setSalvando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/forms/${formId}/capi-token`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // `pixelEsperado` = o que a TELA mostra. O servidor valida sempre contra o do banco;
        // isto só permite a ele detectar que o autosave ainda não gravou e pedir para esperar.
        body: JSON.stringify({ token, pixelEsperado: pixelAtual.trim() }),
      })
      const dados = await r.json().catch(() => ({}))
      if (!r.ok) {
        // O motivo vem traduzido do servidor: a mensagem crua do Meta fala de "object" e "node".
        setErro(dados?.error ?? 'Não foi possível salvar o token.')
        return
      }
      // Some da tela no ato: o valor em claro não fica no estado do React depois de gravado.
      setValor('')
      toast.success('Token validado e salvo.')
      await carregar()
    } catch {
      setErro('Falha de conexão. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    setSalvando(true)
    try {
      const r = await fetch(`/api/forms/${formId}/capi-token`, { method: 'DELETE' })
      if (!r.ok) { toast.error('Não foi possível remover.'); return }
      toast.success('Token removido. O pixel no navegador continua funcionando.')
      setEstado({ configurado: false })
      setErro(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="pt-4 border-t border-slate-200 space-y-3">
      <div>
        <Label htmlFor="capi_token" className="text-sm font-medium text-slate-700">
          Token da API de Conversões <span className="font-normal text-slate-400">(opcional)</span>
        </Label>
        <p className="text-xs text-slate-500 mt-1">
          Com o Pixel sozinho, a conversão é enviada pelo navegador do visitante — e some quando ele
          usa bloqueador de anúncio. Com o token, enviamos também pelo nosso servidor, direto para a
          sua conta.
        </p>
      </div>

      {estado?.configurado ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-900 truncate">
                  Token configurado <span className="font-mono">{estado.dica}</span>
                </p>
                {estado.validadoEm && (
                  <p className="text-xs text-emerald-700">
                    Validado em {new Date(estado.validadoEm).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
            </div>
            <Button
              type="button" variant="ghost" size="sm" disabled={salvando}
              onClick={remover}
              className="text-slate-600 hover:text-red-600 shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {/* O erro de configuração mais provável depois do token errado: trocar o Pixel e
              esquecer o token, que continua apontando para a conta anterior. */}
          {estado.pixelDivergente && (
            <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>
                O Pixel ID mudou depois que este token foi validado. Cole o token da conta do Pixel
                novo — senão o envio pelo servidor vai continuar recusado pelo Meta.
              </span>
            </p>
          )}

          <p className="text-xs text-slate-500">
            Para trocar, cole um token novo por cima. O token salvo nunca é exibido de volta.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              id="capi_token"
              type="password"
              autoComplete="off"
              value={valor}
              onChange={(e) => { setValor(e.target.value); setErro(null) }}
              disabled={!temPixel || salvando}
              className="text-slate-900 placeholder:text-slate-400 bg-white font-mono text-xs"
              placeholder={temPixel ? 'EAAG...' : 'Preencha o Pixel ID acima primeiro'}
            />
            <Button type="button" onClick={salvar} disabled={!temPixel || !valor.trim() || salvando}>
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Validar e salvar'}
            </Button>
          </div>

          {erro && (
            <p className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{erro}</span>
            </p>
          )}

          <a
            href="https://www.facebook.com/events_manager2"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          >
            Onde gerar o token <ExternalLink className="w-3 h-3" />
          </a>
          <p className="text-xs text-slate-500">
            Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões → Gerar token de
            acesso. O token precisa ser da mesma conta do Pixel acima.
          </p>
        </div>
      )}
    </div>
  )
}
