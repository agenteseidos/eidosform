"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TransportName = 'wacli' | 'wuzapi'

type TransportStatus = {
  authenticated: boolean
  connected: boolean
  phoneNumber: string | null
  available: boolean
  error: string | null
}

type WaStatus = {
  authenticated: boolean
  connected: boolean
  phoneNumber: string | null
  primaryTransport: TransportName
  fallbackTransport: TransportName | null
  activeTransport: TransportName
  activeSince: string | null
  fallbackActive: boolean
  fallbackReason: string | null
  fallbackIncident: {
    transport?: TransportName
    since?: string
    reason?: string
  } | null
  transports: Record<TransportName, TransportStatus>
  volume: {
    today: number
    average7Days: number
    coverageDays: number
    elevated: boolean
  }
  sendsByTransport: {
    wacli: number
    wuzapi: number
    fallback: number
    legacy: number
  }
}

type SendLog = {
  id: string
  recipient: string
  form: string
  date: string
  status: 'enviado' | 'erro'
  errorMessage?: string | null
}

const TRANSPORT_LABEL: Record<TransportName, string> = {
  wacli: 'wacli',
  wuzapi: 'WuzAPI',
}

const EMPTY_TRANSPORT: TransportStatus = {
  authenticated: false,
  connected: false,
  phoneNumber: null,
  available: false,
  error: null,
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'agora'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function transportState(status: TransportStatus) {
  if (!status.available) return { label: 'Serviço indisponível', tone: 'red' as const }
  if (status.authenticated && status.connected) return { label: 'Conectado', tone: 'green' as const }
  if (status.authenticated) return { label: 'Reconectando', tone: 'amber' as const }
  if (status.connected) return { label: 'Aguardando QR', tone: 'amber' as const }
  return { label: 'Não conectado', tone: 'slate' as const }
}

export function AdminWhatsAppPanel() {
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [logs, setLogs] = useState<SendLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [qrTransport, setQrTransport] = useState<TransportName | null>(null)
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null)
  const [qrLoading, setQrLoading] = useState<TransportName | null>(null)
  const [qrRefreshing, setQrRefreshing] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<TransportName | null>(null)
  const qrRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      if (!response.ok) throw new Error('Falha ao buscar status')
      const data = (await response.json()) as WaStatus
      setStatus(data)
      setStatusError(null)
      return data
    } catch {
      setStatusError('Não foi possível verificar os motores de envio.')
      return null
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/whatsapp/logs', { cache: 'no-store' })
      if (!response.ok) throw new Error('Falha ao buscar logs')
      const data = (await response.json()) as { logs?: SendLog[] }
      setLogs(data.logs ?? [])
      setLogsError(null)
    } catch {
      setLogs([])
      setLogsError('Não foi possível carregar os logs reais de envio.')
    } finally {
      setLogsLoading(false)
    }
  }, [])

  const clearQr = useCallback(() => {
    if (qrRefreshRef.current) clearTimeout(qrRefreshRef.current)
    setQrBase64(null)
    setQrTransport(null)
    setQrExpiresAt(null)
    setQrRefreshing(false)
    setQrError(null)
  }, [])

  const fetchQr = useCallback(async (transport: TransportName, refresh = false) => {
    if (refresh) setQrRefreshing(true)
    else {
      setQrLoading(transport)
      setQrError(null)
    }
    try {
      const response = await fetch('/api/admin/whatsapp/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao gerar QR code')
      }
      const data = await response.json()
      setQrTransport(transport)
      setQrBase64(data.qr)
      setQrExpiresAt(Number(data.expiresAt) || Date.now() + 45_000)
      setQrError(null)
    } catch (error) {
      setQrError(error instanceof Error ? error.message : 'Erro ao gerar QR')
    } finally {
      setQrLoading(null)
      setQrRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchLogs()
    const statusInterval = setInterval(fetchStatus, 10_000)
    return () => clearInterval(statusInterval)
  }, [fetchLogs, fetchStatus])

  useEffect(() => {
    if (!qrTransport || !qrBase64 || !qrExpiresAt) return
    const targetStatus = status?.transports?.[qrTransport]
    if (targetStatus?.authenticated) {
      clearQr()
      return
    }
    const refreshIn = Math.max(5_000, qrExpiresAt - Date.now() - 8_000)
    qrRefreshRef.current = setTimeout(() => {
      fetchQr(qrTransport, true)
    }, refreshIn)
    return () => {
      if (qrRefreshRef.current) clearTimeout(qrRefreshRef.current)
    }
  }, [clearQr, fetchQr, qrBase64, qrExpiresAt, qrTransport, status?.transports])

  useEffect(() => {
    if (!qrTransport) return
    const interval = setInterval(async () => {
      const next = await fetchStatus()
      if (next?.transports?.[qrTransport]?.authenticated) clearQr()
    }, 3_000)
    return () => clearInterval(interval)
  }, [clearQr, fetchStatus, qrTransport])

  const handleDisconnect = async (transport: TransportName) => {
    const isPrimary = status?.primaryTransport === transport
    const isActive = status?.activeTransport === transport
    const warning = isPrimary || isActive
      ? `Desconectar ${TRANSPORT_LABEL[transport]}, que está configurado como motor ${isPrimary ? 'primário' : 'ativo'}? Se não houver reserva habilitado, as notificações podem parar.`
      : `Desconectar somente o vínculo ${TRANSPORT_LABEL[transport]}? O outro motor não será alterado.`
    if (!confirm(warning)) return

    setDisconnecting(transport)
    try {
      const response = await fetch('/api/admin/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport }),
      })
      if (!response.ok) throw new Error('Falha ao desconectar')
      if (qrTransport === transport) clearQr()
      await fetchStatus()
    } catch (error) {
      setQrError(error instanceof Error ? error.message : 'Erro ao desconectar')
    } finally {
      setDisconnecting(null)
    }
  }

  if (statusLoading) {
    return <div className="py-16 text-center text-sm text-slate-500">Carregando saúde dos motores...</div>
  }

  if (statusError || !status) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="py-8 text-center text-sm text-red-700">
          {statusError || 'Status indisponível.'}
        </CardContent>
      </Card>
    )
  }

  const activeLabel = TRANSPORT_LABEL[status.activeTransport]
  const primaryLabel = TRANSPORT_LABEL[status.primaryTransport]
  const fallbackEnabled = Boolean(status.fallbackTransport)
  const connectionCards: TransportName[] = ['wacli', 'wuzapi']

  return (
    <div className="space-y-6">
      <section
        className={`rounded-xl border px-5 py-5 sm:px-6 ${
          status.fallbackActive
            ? 'border-red-300 bg-red-50'
            : 'border-blue-200 bg-blue-50'
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-lg p-2 ${status.fallbackActive ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {status.fallbackActive ? <AlertTriangle className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Motor ativo agora</p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{activeLabel}</h3>
              <p className="mt-1 text-sm text-slate-600">
                Desde {formatDateTime(status.activeSince)} · primário configurado: {primaryLabel}
              </p>
            </div>
          </div>
          <div className={`text-sm font-semibold ${fallbackEnabled ? 'text-amber-700' : 'text-slate-600'}`}>
            {fallbackEnabled
              ? `Reserva habilitado: ${TRANSPORT_LABEL[status.fallbackTransport!]}`
              : 'Fallback desligado por configuração'}
          </div>
        </div>
        {status.fallbackActive && (
          <div className="mt-4 border-t border-red-200 pt-4 text-sm text-red-800">
            Rodando no reserva desde {formatDateTime(status.fallbackIncident?.since || status.activeSince)}.
            Motivo seguro: {status.fallbackReason || status.fallbackIncident?.reason || 'falha pré-envio do primário'}.
          </div>
        )}
      </section>

      <Card className={status.volume.elevated ? 'border-amber-300' : 'border-slate-200'}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Volume de notificações
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-[1fr_1fr_1.5fr] sm:items-end">
            <div>
              <p className="text-sm text-slate-500">Envios hoje</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{status.volume.today}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Média dos 7 dias anteriores</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                {status.volume.average7Days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              </p>
            </div>
            <div className={`rounded-lg px-4 py-3 text-sm ${
              status.volume.elevated ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'
            }`}>
              {status.volume.elevated
                ? 'Volume muito acima do padrão recente. Verifique campanhas e formulários ativos.'
                : status.volume.coverageDays < 7
                  ? `Média em formação: ${status.volume.coverageDays} de 7 dias com histórico disponível.`
                  : 'Volume dentro do padrão recente.'}
            </div>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">Conexões</h3>
          <p className="mt-1 text-sm text-slate-600">
            Cada motor tem vínculo próprio. Você pode parear o motor inativo sem trocar o motor de produção.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {connectionCards.map((transport) => {
            const engine = status.transports?.[transport] || EMPTY_TRANSPORT
            const state = transportState(engine)
            const isPrimary = status.primaryTransport === transport
            const isFallback = status.fallbackTransport === transport
            const isActive = status.activeTransport === transport
            const toneClasses = {
              green: 'bg-green-500 text-green-700',
              amber: 'bg-amber-500 text-amber-700',
              red: 'bg-red-500 text-red-700',
              slate: 'bg-slate-400 text-slate-600',
            }[state.tone]

            return (
              <Card key={transport} className={isActive ? 'border-blue-300' : 'border-slate-200'}>
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-semibold text-slate-900">{TRANSPORT_LABEL[transport]}</h4>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {isPrimary ? 'Primário' : isFallback ? 'Reserva' : 'Inativo'}
                          </span>
                          {isActive && (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              Em uso
                            </span>
                          )}
                        </div>
                        <div className={`mt-2 flex items-center gap-2 text-sm font-medium ${toneClasses.split(' ').at(-1)}`}>
                          <span className={`h-2.5 w-2.5 rounded-full ${toneClasses.split(' ')[0]}`} />
                          {state.label}
                        </div>
                        {engine.phoneNumber && (
                          <p className="mt-2 text-sm text-slate-500">Número: {engine.phoneNumber}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    {!engine.authenticated && (
                      <button
                        type="button"
                        onClick={() => fetchQr(transport)}
                        disabled={qrLoading !== null}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {qrLoading === transport ? (
                          <><RefreshCw className="h-4 w-4 animate-spin" /> Gerando QR...</>
                        ) : (
                          <><QrCode className="h-4 w-4" /> Conectar por QR</>
                        )}
                      </button>
                    )}
                    {(engine.authenticated || engine.connected) && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(transport)}
                        disabled={disconnecting !== null}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        {disconnecting === transport ? (
                          <><RefreshCw className="h-4 w-4 animate-spin" /> Desconectando...</>
                        ) : (
                          <><Unplug className="h-4 w-4" /> Desconectar {TRANSPORT_LABEL[transport]}</>
                        )}
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {qrTransport && qrBase64 && (
        <Card className="border-green-300">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <QrCode className="h-5 w-5 text-green-700" />
              Parear {TRANSPORT_LABEL[qrTransport]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-[280px_1fr] md:items-center">
              <div className="relative flex min-h-[280px] items-center justify-center rounded-xl bg-white p-3 ring-1 ring-slate-200">
                {/* QR é data URL de runtime; next/image não otimiza base64 inline. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt={`QR Code para conectar ${TRANSPORT_LABEL[qrTransport]}`}
                  className={`h-64 w-64 object-contain ${qrRefreshing ? 'opacity-40' : 'opacity-100'}`}
                  style={{ imageRendering: 'pixelated' }}
                />
                {qrRefreshing && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Renovando QR...
                  </div>
                )}
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-900">O QR renova sozinho nesta tela</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  No celular do número de notificações, abra WhatsApp → Configurações → Aparelhos conectados →
                  Conectar aparelho. Mantenha esta página aberta durante o escaneamento.
                </p>
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Pareamento direcionado ao motor {TRANSPORT_LABEL[qrTransport]}; o outro vínculo não é alterado.
                </div>
                <button
                  type="button"
                  onClick={clearQr}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  Fechar QR
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {qrError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {qrError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Envios por motor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-sm text-slate-500">wacli</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{status.sendsByTransport.wacli}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">WuzAPI</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{status.sendsByTransport.wuzapi}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Via fallback</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{status.sendsByTransport.fallback}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Legado importado</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{status.sendsByTransport.legacy}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Últimos envios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {logsLoading ? (
              <div className="py-8 text-center text-sm text-slate-500">Carregando logs reais...</div>
            ) : logsError ? (
              <div className="py-8 text-center text-sm text-slate-500">{logsError}</div>
            ) : logs.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">Ainda não há logs reais de envios.</div>
            ) : (
              logs.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 border-b py-3 last:border-0 sm:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-2 h-2 w-2 flex-none rounded-full ${
                      item.status === 'enviado' ? 'bg-green-500' : 'bg-red-500'
                    }`} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{item.recipient}</div>
                      <div className="truncate text-sm text-slate-500">{item.form}</div>
                      {item.errorMessage && (
                        <div className="truncate text-xs text-red-600">{item.errorMessage}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex-none whitespace-nowrap text-sm text-slate-500">
                    {new Date(item.date).toLocaleString('pt-BR')}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
