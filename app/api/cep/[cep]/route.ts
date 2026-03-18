import { NextRequest, NextResponse } from 'next/server'

// Cache simples em memória
const cepCache = new Map<string, ViaCEPResponse>()

interface ViaCEPResponse {
  logradouro: string
  bairro: string
  localidade: string
  uf: string
  erro?: boolean
}

export interface CEPResult {
  cep: string
  rua: string
  bairro: string
  cidade: string
  estado: string
}

interface RouteParams {
  params: Promise<{ cep: string }>
}

// GET /api/cep/[cep] — consulta endereço por CEP via ViaCEP
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { cep } = await params
  const cleanCep = cep.replace(/\D/g, '')

  if (cleanCep.length !== 8) {
    return NextResponse.json({ error: 'CEP inválido. Informe 8 dígitos.' }, { status: 400 })
  }

  if (cepCache.has(cleanCep)) {
    const cached = cepCache.get(cleanCep)!
    if (cached.erro) {
      return NextResponse.json({ error: 'CEP não encontrado' }, { status: 404 })
    }
    return NextResponse.json(formatResult(cleanCep, cached))
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)

    if (!res.ok) {
      return NextResponse.json({ error: 'Erro ao consultar ViaCEP' }, { status: 502 })
    }

    const data: ViaCEPResponse = await res.json()
    cepCache.set(cleanCep, data)

    if (data.erro) {
      return NextResponse.json({ error: 'CEP não encontrado' }, { status: 404 })
    }

    return NextResponse.json(formatResult(cleanCep, data))
  } catch (err) {
    console.error('ViaCEP fetch error:', err)
    return NextResponse.json({ error: 'Erro ao consultar ViaCEP' }, { status: 502 })
  }
}

function formatResult(cep: string, data: ViaCEPResponse): CEPResult {
  return {
    cep,
    rua: data.logradouro || '',
    bairro: data.bairro || '',
    cidade: data.localidade || '',
    estado: data.uf || '',
  }
}
