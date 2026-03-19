import { NextRequest, NextResponse } from 'next/server'

type Params = { params: Promise<{ cep: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { cep } = await params
  const cleaned = cep.replace(/\D/g, '')

  if (!/^\d{8}$/.test(cleaned)) {
    return NextResponse.json({ error: 'CEP must be 8 digits' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()

    if (data.erro) {
      return NextResponse.json({ error: 'CEP not found' }, { status: 404 })
    }

    return NextResponse.json({
      cep: data.cep,
      street: data.logradouro || '',
      complement: data.complemento || '',
      neighborhood: data.bairro || '',
      city: data.localidade || '',
      state: data.uf || '',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch CEP' }, { status: 502 })
  }
}
