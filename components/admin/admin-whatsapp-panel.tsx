"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, QrCode, RefreshCw, Smartphone, Unplug } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type WaStatus = {
  authenticated: boolean
  connected: boolean
  phoneNumber: string | null
}

type SendLog = {
  id: string
  recipient: string
  form: string
  date: string
  status: 'enviado' | 'erro'
}

const MOCK_LOGS: SendLog[] = [
  { id: '1', recipient: '+55 81 99999-0001', form: 'Pesquisa de Satisfação', date: '2026-04-06 21:30', status: 'enviado' },
  { id: '2', recipient: '+55 81 99999-0002', form: 'Formulário de Contato', date: '2026-04-06 21:15', status: 'enviado' },
  { id: '3', recipient: '+55 81 99999-0003', form: 'Inscrição Evento', date: '2026-04-06 20:45', status: 'erro' },
  { id: '4', recipient: '+55 81 99999-0004', form: 'Pesquisa de Satisfação', date: '2026-04-06 20:10', status: 'enviado' },
  { id: '5', recipient: '+55 81 99999-0005', form: 'Feedback Produto', date: '2026-04-06 19:55', status: 'enviado' },
]

const QR_EXPIRY_MS = 60_000

export function AdminWhatsappPanel() {
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [qrBlob, setQrBlob] = useState<Blob | null>(null)
  const [qrObjectUrl, setQrObjectUrl] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrGeneratedAt, setQrGeneratedAt] = useState<number | null>(null)
  const [qrExpired, setQrExpired] = useState(false)

  const [disconnecting, setDisconnecting] = useState(false)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl)
    }
  }, [qrObjectUrl])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/status')
      if (!res.ok) throw new Error('Falha ao buscar status')
      const data = (await res.json()) as WaStatus
      setStatus(data)
      setStatusError(null)
      return data
    } catch {
      setStatusError('Não foi possível verificar o status.')
      return null
    } finally {
      setStatusLoading(false)
    }
  }, [])

  // Initial status load
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // QR expiry timer
  useEffect(() => {
    if (!qrGeneratedAt) return
    setQrExpired(false)

    const checkExpiry = () => {
      if (Date.now() - qrGeneratedAt >= QR_EXPIRY_MS) {
        setQrExpired(true)
        stopPolling()
        if (qrTimerRef.current) clearInterval(qrTimerRef.current)
      }
    }

    qrTimerRef.current = setInterval(checkExpiry, 1000)
    return () => {
      if (qrTimerRef.current) clearInterval(qrTimerRef.current)
    }
  }, [qrGeneratedAt])

  const startPolling = useCallback(() => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      const data = await fetchStatus()
      if (data?.connected) {
        stopPolling()
        clearQr()
      }
    }, 3000)
  }, [fetchStatus])

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const clearQr = () => {
    setQrBlob(null)
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl)
    setQrObjectUrl(null)
    setQrGeneratedAt(null)
    setQrExpired(false)
    setQrError(null)
  }

  const handleGenerateQr = async () => {
    setQrLoading(true)
    setQrError(null)
    clearQr()

    try {
      const res = await fetch('/api/admin/whatsapp/qr', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao gerar QR code')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setQrBlob(blob)
      setQrObjectUrl(url)
      setQrGeneratedAt(Date.now())
      startPolling()
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Erro ao gerar QR')
    } finally {
      setQrLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o número do WhatsApp?')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/admin/whatsapp/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao desconectar')
      clearQr()
      stopPolling()
      await fetchStatus()
    } catch {
      alert('Erro ao desconectar.')
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = status?.connected ?? false

  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-green-600" />
            Status da Conexão
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Verificando...
            </div>
          ) : statusError ? (
            <p className="text-sm text-red-600">{statusError}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                  connected
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {connected ? '✅ Conectado' : '❌ Desconectado'}
              </span>
              {status?.phoneNumber && (
                <span className="text-sm text-slate-600">
                  📞 {status.phoneNumber}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code + Actions */}
      {!connected && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <QrCode className="h-5 w-5" />
                QR Code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {qrObjectUrl && !qrExpired ? (
                <div className="space-y-3">
                  <img
                    src={qrObjectUrl}
                    alt="WhatsApp QR Code"
                    className="mx-auto rounded-lg border border-slate-200 bg-white p-2"
                    width={256}
                    height={256}
                  />
                  <p className="text-center text-xs text-slate-500">
                    Aguardando escaneamento...
                  </p>
                </div>
              ) : qrExpired ? (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-amber-600">
                    ⏰ QR Code expirado
                  </p>
                  <button
                    onClick={handleGenerateQr}
                    disabled={qrLoading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${qrLoading ? 'animate-spin' : ''}`} />
                    Gerar novo QR
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGenerateQr}
                  disabled={qrLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {qrLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <QrCode className="h-4 w-4" />
                      Gerar QR Code
                    </>
                  )}
                </button>
              )}

              {qrError && (
                <p className="text-sm text-red-600">{qrError}</p>
              )}
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Smartphone className="h-5 w-5" />
                Como conectar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm text-slate-700">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    1
                  </span>
                  <span>Abra o <strong>WhatsApp</strong> no celular</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    2
                  </span>
                  <span>Toque em <strong>Dispositivos conectados</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    3
                  </span>
                  <span>Toque em <strong>Conectar dispositivo</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    4
                  </span>
                  <span>Aponte a câmera para o <strong>QR Code</strong> ao lado</span>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Disconnect Button */}
      {connected && (
        <div>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {disconnecting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Desconectando...
              </>
            ) : (
              <>
                <Unplug className="h-4 w-4" />
                Desconectar WhatsApp
              </>
            )}
          </button>
        </div>
      )}

      {/* Send Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Últimos envios</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Destinatário</th>
                  <th className="pb-2 pr-4 font-medium">Formulário</th>
                  <th className="pb-2 pr-4 font-medium">Data</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {MOCK_LOGS.map((log) => (
                  <tr key={log.id} className="text-slate-700">
                    <td className="py-2 pr-4">{log.recipient}</td>
                    <td className="py-2 pr-4">{log.form}</td>
                    <td className="py-2 pr-4 text-slate-500">{log.date}</td>
                    <td className="py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          log.status === 'enviado'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {log.status === 'enviado' ? 'Enviado' : 'Erro'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Dados de demonstração. Logs reais serão exibidos quando o backend de envio estiver integrado.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
