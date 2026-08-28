import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { decidirOrfaos, inventariarObjetos, TETO_POR_RODADA } from '@/lib/form-file-sweep'
import { sendBillingOpsAlert } from '@/lib/resend'
import { log, logError } from '@/lib/logger'
import { isValidBearerSecret } from '@/lib/bearer-auth'

/**
 * GET /api/cron/anexos-orfaos — varre o bucket e remove arquivo que nenhuma ficha viva protege.
 *
 * Escrita em 27/08/2026, junto com a correção do P0 em que EDITAR um formulário apagava os
 * anexos. Dois comentários no código já prometiam esta varredura ("fica para a varredura de
 * órfãos") e ela **nunca existiu** — a auditoria descobriu ao procurá-la.
 *
 * Recolhe os dois tipos: ficha revogada com objeto vivo (o `remove()` falhou) e objeto sem
 * ficha nenhuma (o cascade levou a linha junto — legado do período 17→27/08, em que o DELETE
 * deixou de purgar). O segundo é o órfão invisível: não há registro dele em lugar nenhum.
 *
 * SEGURANÇA: ficha viva (`pending`/`ready`/`claimed`) SEMPRE protege o objeto; idade mínima de
 * 24h; teto por rodada. Remoção de arquivo é irreversível — na dúvida, não remove.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isValidBearerSecret(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[cron/anexos-orfaos] SUPABASE service-role env ausente')
    return NextResponse.json({ error: 'Config indisponível' }, { status: 503 })
  }
  const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // 1) Inventário dos dois lados. Se QUALQUER um falhar, a rodada é abortada sem remover nada:
  //    lista incompleta de fichas transformaria arquivo protegido em "órfão".
  let objetos
  try {
    objetos = await inventariarObjetos(db)
  } catch (err) {
    logError('[cron/anexos-orfaos] inventário do storage falhou — nada removido', err)
    return NextResponse.json({ ok: true, abortado: 'storage_ilegivel' })
  }

  const { data: fichas, error: erroFichas } = await db
    .from('form_files')
    .select('object_path, status')
    .limit(10000)
  if (erroFichas) {
    // ⚠️ Abortar aqui é OBRIGATÓRIO: sem a lista de fichas, TODO objeto pareceria órfão.
    logError('[cron/anexos-orfaos] leitura das fichas falhou — nada removido', erroFichas)
    return NextResponse.json({ ok: true, abortado: 'fichas_ilegiveis' })
  }

  const orfaos = decidirOrfaos({
    objetos,
    fichas: (fichas ?? []) as Array<{ object_path: string; status: string }>,
  })

  const lote = orfaos.slice(0, TETO_POR_RODADA)
  const truncado = orfaos.length > lote.length
  let removidos = 0
  let falhas = 0

  if (lote.length) {
    const { error } = await db.storage.from('form-uploads').remove(lote.map((o) => o.caminho))
    if (error) {
      falhas = lote.length
      logError('[cron/anexos-orfaos] remoção falhou — tenta na próxima rodada', error, { quantidade: lote.length })
    } else {
      removidos = lote.length
    }
  }

  const semFicha = lote.filter((o) => o.motivo === 'sem_ficha').length
  const fichaRevogada = lote.filter((o) => o.motivo === 'ficha_revogada').length
  const resultado = {
    ok: true,
    objetos: objetos.length,
    orfaos: orfaos.length,
    removidos,
    falhas,
    semFicha,
    fichaRevogada,
    ...(truncado ? { truncado: orfaos.length - lote.length } : {}),
  }

  // ALERTA. Órfão não é rotina: em operação normal a purga já remove na hora. Volume alto é
  // sintoma de outra coisa quebrada — foi assim que o P0 do PATCH ficou 10 dias invisível.
  // `truncado` também alerta: silenciar corte é o defeito que a auditoria do expire-plans achou.
  if (semFicha > 0 || truncado || falhas > 0) {
    await sendBillingOpsAlert({
      subject: '🟠 Anexos órfãos encontrados no storage',
      lines: {
        'O QUE ISSO SIGNIFICA': semFicha > 0
          ? 'Há arquivo no storage sem NENHUMA ficha no banco — o registro sumiu (cascade) e o arquivo ficou. Verificar se alguma exclusão deixou de purgar.'
          : truncado ? 'Mais órfãos do que o teto por rodada — a fila continua na próxima.'
          : 'A remoção falhou; os arquivos seguem no storage.',
        objetosNoBucket: String(objetos.length), orfaos: String(orfaos.length),
        semFicha: String(semFicha), fichaRevogada: String(fichaRevogada),
        removidos: String(removidos), falhas: String(falhas),
      },
    }).catch((e) => logError('[cron/anexos-orfaos] alerta não entregue', e))
  }

  if (orfaos.length > 0) log('[cron/anexos-orfaos] concluído', resultado)
  return NextResponse.json(resultado)
}
