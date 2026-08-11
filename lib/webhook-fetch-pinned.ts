/**
 * Conexão com IP CONFERIDO NA HORA — fecha a janela do DNS rebinding (E08-S1-008).
 *
 * 🐞 O DEFEITO: `validateWebhookUrlAsync` resolve o domínio e recusa IP privado — mas quem
 * conecta é o `fetch`, que resolve o DNS DE NOVO, sozinho. Entre a checagem e a conexão existe
 * uma janela: um domínio controlado pelo atacante responde IP público na validação e IP interno
 * (169.254.169.254, 10.x, 127.x) no momento da conexão. É o clássico TOCTOU de DNS.
 *
 * QUEM É O ATACANTE AQUI: o webhook_url é configurado pelo DONO do formulário, então o ataque
 * exige uma conta paga — não é anônimo. Mesmo assim é a nossa rede interna que estaria exposta,
 * e o custo de fechar é baixo.
 *
 * COMO: um dispatcher do undici com `lookup` próprio. O Node resolve, e nós conferimos CADA
 * endereço no instante da conexão; privado → o socket nem abre. Diferente da validação prévia,
 * isto não tem janela: é o mesmo endereço que a conexão vai usar.
 *
 * ⚠️ DEGRADAÇÃO DELIBERADA: se o runtime não expuser undici (Edge) ou o dispatcher falhar ao ser
 * criado, devolvemos `null` e o chamador segue com o `fetch` normal. Webhook é recurso PAGO —
 * derrubar a entrega de todo mundo por causa de um endurecimento seria trocar um risco raro
 * (atacante autenticado) por um dano certo (lead não entregue). A validação prévia continua de pé
 * nesse caminho, que é exatamente a proteção que existia antes desta função.
 */
import { lookup as dnsLookup } from 'node:dns'
import { isPrivateIP } from '@/lib/webhook-validator'
import { logWarn } from '@/lib/logger'

/** Erro lançado quando o endereço resolvido no momento da conexão é interno. */
export class EnderecoInternoBloqueado extends Error {
  constructor(ip: string) {
    super(`DNS rebinding bloqueado: o host resolveu para o endereço interno ${ip} no momento da conexão`)
    this.name = 'EnderecoInternoBloqueado'
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void

/**
 * `lookup` que recusa endereço interno. Exportado para teste: é a regra inteira desta defesa,
 * e testá-la através de uma conexão real seria frágil.
 */
export function lookupQueRecusaInterno(
  hostname: string,
  options: unknown,
  callback: LookupCallback,
): void {
  const opts = (options ?? {}) as { all?: boolean }
  dnsLookup(hostname, { ...(opts as object), all: true } as never, (err, enderecos) => {
    if (err) return callback(err)
    const lista = (Array.isArray(enderecos) ? enderecos : []) as Array<{ address: string; family: number }>
    if (lista.length === 0) {
      return callback(Object.assign(new Error('sem endereço resolvido'), { code: 'ENOTFOUND' }))
    }
    // UM endereço interno reprova o host inteiro. Escolher "só os públicos" deixaria o atacante
    // controlar a escolha do Node numa lista mista — regra `some`, nunca `filter`.
    const interno = lista.find((e) => isPrivateIP(e.address))
    if (interno) {
      logWarn('[webhook-pin] conexão bloqueada — host resolveu para endereço interno', {
        hostname, endereco: interno.address,
      })
      return callback(new EnderecoInternoBloqueado(interno.address))
    }
    if (opts.all) return callback(null, lista)
    return callback(null, lista[0].address, lista[0].family)
  })
}

/**
 * Dispatcher com o lookup acima, ou `null` quando o runtime não permite (o chamador então usa o
 * fetch normal — ver a nota de degradação no topo).
 */
export function criarDispatcherComPino(): unknown | null {
  try {
    // Resolução DINÂMICA por createRequire: em Edge Runtime o módulo não existe, e um import
    // estático quebraria o build inteiro por causa de um endurecimento opcional.
    const { createRequire } = eval('require')('node:module') as { createRequire: (u: string) => (m: string) => unknown }
    const req = createRequire(__filename)
    const { Agent } = req('undici') as { Agent: new (o: unknown) => unknown }
    return new Agent({ connect: { lookup: lookupQueRecusaInterno } })
  } catch (err) {
    logWarn('[webhook-pin] undici indisponível — seguindo sem pino de IP (validação prévia continua)', {
      err: String(err).slice(0, 120),
    })
    return null
  }
}
