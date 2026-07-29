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
  /** Contadores dia a dia (chave 'YYYY-MM-DD', fuso America/Recife). */
  daily?: Record<string, DayCounters>
  /** ISO de quando a atribuição por motor passou a ser gravada. */
  transportAttributionSince?: string | null
}

type DayCounters = {
  total: number
  wacli: number
  wuzapi: number
  fallback: number
  legacy: number
  failed: number
}

type SendLog = {
  id: string
  recipient: string
  form: string
  date: string
  status: 'enviado' | 'erro' | 'na fila' | 'ignorado'
  kind?: 'lead' | 'abandono'
  transport?: TransportName | string | null
  errorMessage?: string | null
}

type PeriodoId = 'hoje' | 'ontem' | '7dias' | '30dias' | 'tudo' | 'custom'

const PERIODOS: { id: PeriodoId; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7dias', label: 'Últimos 7 dias' },
  { id: '30dias', label: 'Últimos 30 dias' },
  { id: 'tudo', label: 'Todo o período' },
  { id: 'custom', label: 'Customizado' },
]

/**
 * Chave de dia no MESMO fuso usado pelas métricas do servidor (America/Recife).
 * Usar a data local do navegador daria divergência de um dia para quem estiver
 * em outro fuso, e "hoje" no painel não bateria com "hoje" no alarme.
 */
function chaveDia(date: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]))
  return `${v.year}-${v.month}-${v.day}`
}

function deslocaDia(chave: string, dias: number): string {
  const d = new Date(`${chave}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Soma os contadores dos dias dentro do intervalo [de, ate] (inclusivo). */
function somaPeriodo(daily: Record<string, DayCounters>, de: string | null, ate: string | null) {
  const total: DayCounters = { total: 0, wacli: 0, wuzapi: 0, fallback: 0, legacy: 0, failed: 0 }
  let diasComDado = 0
  for (const [dia, c] of Object.entries(daily)) {
    if (de && dia < de) continue
    if (ate && dia > ate) continue
    diasComDado += 1
    total.total += c.total
    total.wacli += c.wacli
    total.wuzapi += c.wuzapi
    total.fallback += c.fallback
    total.legacy += c.legacy
    total.failed += c.failed
  }
  return { ...total, diasComDado }
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
  const [periodo, setPeriodo] = useState<PeriodoId>('tudo')
  const [customDe, setCustomDe] = useState('')
  const [customAte, setCustomAte] = useState('')
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
  // PRIMÁRIO PRIMEIRO. Hoje isso põe o WuzAPI na frente, que é o pedido; e se um
  // dia houver rollback para o wacli a ordem se ajusta sozinha, sem depender de
  // alguém lembrar de mexer aqui.
  const connectionCards: TransportName[] = status.primaryTransport === 'wuzapi'
    ? ['wuzapi', 'wacli']
    : ['wacli', 'wuzapi']

  const daily = status.daily ?? {}
  const hojeChave = chaveDia(new Date())
  const intervalo: { de: string | null; ate: string | null } =
    periodo === 'hoje' ? { de: hojeChave, ate: hojeChave }
    : periodo === 'ontem' ? { de: deslocaDia(hojeChave, -1), ate: deslocaDia(hojeChave, -1) }
    : periodo === '7dias' ? { de: deslocaDia(hojeChave, -6), ate: hojeChave }
    : periodo === '30dias' ? { de: deslocaDia(hojeChave, -29), ate: hojeChave }
    : periodo === 'custom' ? { de: customDe || null, ate: customAte || null }
    : { de: null, ate: null }
  const totais = somaPeriodo(daily, intervalo.de, intervalo.ate)

  // A separação por motor só começou a existir quando as métricas foram criadas.
  // Dias anteriores vieram de uma importação e não sabem por onde saíram — dizer
  // isso é melhor do que exibir um número que parece completo e não é.
  const inicioAtribuicao = status.transportAttributionSince
    ? chaveDia(new Date(status.transportAttributionSince))
    : null
  const periodoAlcancaAntesDaAtribuicao = Boolean(
    inicioAtribuicao && (!intervalo.de || intervalo.de < inicioAtribuicao)
  )

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
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodo(p.id)}
                className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  periodo === p.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {periodo === 'custom' && (
            <div className="mb-5 flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-600">
                De
                <input
                  type="date"
                  value={customDe}
                  max={customAte || undefined}
                  onChange={(e) => setCustomDe(e.target.value)}
                  className="mt-1 block min-h-9 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="text-sm text-slate-600">
                Até
                <input
                  type="date"
                  value={customAte}
                  min={customDe || undefined}
                  onChange={(e) => setCustomAte(e.target.value)}
                  className="mt-1 block min-h-9 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </label>
              {!customDe && !customAte && (
                <p className="pb-2 text-sm text-slate-500">Escolha ao menos uma data.</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <p className="text-sm text-slate-500">Total</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totais.total}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">WuzAPI</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totais.wuzapi}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">wacli</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totais.wacli}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Via reserva</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totais.fallback}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Falhas</p>
              <p className={`mt-1 text-2xl font-bold ${totais.failed > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {totais.failed}
              </p>
            </div>
          </div>

          {/* Honestidade sobre a cobertura do dado: os envios anteriores a
              27/07/2026 foram importados sem identificação de motor. Some
              sozinho conforme os dias novos entram na janela. */}
          {periodoAlcancaAntesDaAtribuicao && totais.legacy > 0 && (
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <strong>{totais.legacy}</strong> destes envios são anteriores a 27/07/2026 e não têm motor
              identificado — a separação por motor só passou a ser gravada nessa data. Eles entram no
              total, mas não em WuzAPI nem wacli.
            </p>
          )}
          {totais.diasComDado === 0 && (
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Nenhum envio registrado neste período.
            </p>
          )}
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
                      item.status === 'enviado' ? 'bg-green-500' :
                      item.status === 'na fila' ? 'bg-amber-500' :
                      item.status === 'ignorado' ? 'bg-slate-300' : 'bg-red-500'
                    }`} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">
                        {item.recipient}
                        {/* Envios anteriores a 27/07/2026 não gravavam o motor.
                            Mostrar "—" é melhor que omitir: deixa claro que o
                            dado não existe, em vez de parecer que não passou
                            por motor nenhum. */}
                        <span className="ml-1.5 font-normal text-slate-500">
                          ({item.transport
                            ? TRANSPORT_LABEL[item.transport as TransportName] ?? item.transport
                            : '—'})
                        </span>
                      </div>
                      <div className="truncate text-sm text-slate-500">
                        {item.form}
                        {item.kind === 'abandono' && (
                          <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                            alerta de abandono
                          </span>
                        )}
                      </div>
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
