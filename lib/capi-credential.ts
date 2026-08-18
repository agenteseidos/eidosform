/**
 * lib/capi-credential.ts — o cofre do token de CAPI do cliente.
 *
 * POR QUE ISTO EXISTE (18/08/2026). Até hoje o envio server-side para o Meta usava UM pixel e UM
 * token GLOBAIS — os do Instituto Eidos. O cliente colava o pixel DELE no construtor, acreditava
 * que a conversão chegava na conta DELE, e o servidor mandava tudo para a NOSSA. Duas
 * consequências: a conversão do cliente nunca chegava por esse caminho, e o e-mail/telefone
 * (hasheados, mas reconhecíveis pelo Meta) do lead DELE ia parar no NOSSO ativo de publicidade.
 *
 * Corrigir exige o token do cliente, porque o Pixel ID sozinho não autentica nada: ele é público
 * — está no código-fonte de qualquer página que anuncia. Se o Meta aceitasse eventos server-side
 * só com o pixel, qualquer um despejaria conversão falsa na conta de qualquer concorrente.
 *
 * ⚠️ O TOKEN NÃO PODE MORAR EM `forms.pixels`. Essa coluna é selecionada na página PÚBLICA do
 * formulário (`app/f/[slug]/page.tsx`) e viaja inteira para o navegador de todo visitante. O
 * Pixel ID pode — é público por natureza. O token, não: seria publicar a credencial do cliente.
 * Por isso ele vive em TABELA PRÓPRIA (`form_capi_credentials`), fora do alcance de qualquer
 * `SELECT` de `forms` — a mesma disciplina de `form_files`.
 *
 * E vive CIFRADO. Não é paranoia proporcional a "senha de e-mail": é uma credencial que injeta
 * eventos na conta de anúncios de um terceiro. Cifrado, um vazamento do banco não entrega token
 * utilizável — só entrega blob sem a chave, que mora na Vercel.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Chave de 32 bytes em hex (64 caracteres) em `META_CAPI_ENC_KEY`.
 *
 * SEM CADEIA DE FALLBACK, de propósito (lição do `file-link-token.ts`): cair num segredo genérico
 * quando o dedicado falta faz a ausência de configuração passar despercebida — e aí o cofre está
 * fechado com a chave que meio mundo do sistema conhece. Sem a var certa, isto simplesmente não
 * funciona, e o erro aparece na hora de salvar.
 */
function chave(): Buffer | null {
  const bruta = process.env.META_CAPI_ENC_KEY
  if (!bruta || !/^[0-9a-fA-F]{64}$/.test(bruta.trim())) return null
  return Buffer.from(bruta.trim(), 'hex')
}

export function cofreConfigurado(): boolean {
  return chave() !== null
}

/** Cifra o token. Devolve `null` se a chave não estiver configurada — quem chama recusa o save. */
export function cifrarToken(tokenClaro: string): string | null {
  const k = chave()
  if (!k || !tokenClaro) return null
  // IV novo a cada cifragem: em GCM, repetir (chave, IV) destrói a garantia do modo.
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([cipher.update(tokenClaro, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('hex')}.${tag.toString('hex')}.${ct.toString('base64')}`
}

/**
 * Decifra. Devolve `null` em qualquer anomalia — chave ausente, formato estranho, tag que não
 * confere (blob adulterado no banco). Nunca lança: isto roda no caminho do submit, e derrubar o
 * envio de um lead porque o token está corrompido puniria o lead pelo erro de configuração.
 */
export function decifrarToken(blob: string | null | undefined): string | null {
  const k = chave()
  if (!k || !blob) return null
  const partes = blob.split('.')
  if (partes.length !== 4 || partes[0] !== 'v1') return null
  try {
    const iv = Buffer.from(partes[1], 'hex')
    const tag = Buffer.from(partes[2], 'hex')
    const ct = Buffer.from(partes[3], 'base64')
    if (iv.length !== 12 || tag.length !== 16) return null
    const decipher = createDecipheriv('aes-256-gcm', k, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * A "dica" que a interface mostra no lugar do token: os 4 últimos caracteres.
 *
 * Serve para o cliente reconhecer QUAL token está lá sem que o token volte para o navegador. É o
 * mesmo motivo de um cartão salvo mostrar "•••• 4242": identifica sem expor.
 */
export function dicaDoToken(tokenClaro: string): string {
  return tokenClaro.length <= 4 ? '••••' : `••••${tokenClaro.slice(-4)}`
}
