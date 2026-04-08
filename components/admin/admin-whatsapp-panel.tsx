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

export function AdminWhatsAppPanel() {
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [qrAscii, setQrAscii] = useState<string | null>(null)
  const [qrGeneratedAt, setQrGeneratedAt] = useState<number | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrExpired, setQrExpired] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [logs, setLogs] = useState<SendLog[]>(MOCK_LOGS)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    setQrAscii(null)
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

      const data = await res.json()
      setQrAscii(data.qr)
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
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Erro ao desconectar')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Status WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="text-center py-8 text-gray-500">Carregando...</div>
          ) : statusError ? (
            <div className="text-center py-8 text-red-500">{statusError}</div>
          ) : !status ? null : status.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-green-600 font-medium">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                Conectado
              </div>
              {status.phoneNumber && (
                <div className="text-sm text-gray-600">
                  Número: {status.phoneNumber}
                </div>
              )}
            </div>
          ) : status.authenticated ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-yellow-600 font-medium">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Autenticando...
              </div>
              <div className="text-sm text-gray-600">
                Aguarde a conexão ser estabelecida.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-gray-500">Não conectado</div>
              <button
                onClick={handleGenerateQr}
                disabled={qrLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {qrLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <QrCode className="w-4 h-4" />
                    Gerar QR Code
                  </>
                )}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code Card */}
      {qrAscii && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" />
              QR Code WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-[500px]">
            <div className="space-y-4">
              {qrExpired ? (
                <div className="text-center py-8 text-orange-600">
                  QR Code expirado. Gere um novo.
                </div>
              ) : (
                <>
                  <div className="w-full overflow-x-auto">
                    <pre className="text-sm leading-none bg-black text-green-400 p-4 rounded whitespace-pre inline-block min-w-full">
                      {qrAscii}
                    </pre>
                  </div>
                  <div className="text-center text-sm text-gray-600">
                    Escaneie com o WhatsApp Business → Dispositivos conectados
                  </div>
                  <div className="text-center text-sm text-blue-600">
                    {status?.authenticated ? 'Aguardando escaneamento...' : 'Aguardando autenticação...'}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {qrError && (
        <div className="text-center py-4 text-red-500 bg-red-50 rounded-lg">
          {qrError}
        </div>
      )}

      {/* Disconnect Button */}
      {status?.connected && (
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {disconnecting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Desconectando...
            </>
          ) : (
            <>
              <Unplug className="w-4 h-4" />
              Desconectar WhatsApp
            </>
          )}
        </button>
      )}

      {/* Logs Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Últimos envios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      log.status === 'enviado' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <div>
                    <div className="font-medium">{log.recipient}</div>
                    <div className="text-sm text-gray-500">{log.form}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-500">{log.date}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
