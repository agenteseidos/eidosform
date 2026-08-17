import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { purgarAnexos } from '@/lib/form-file-purge'
import { log, logError } from '@/lib/logger'

/**
 * DELETE /api/responses/[id] — apagar uma resposta apaga o anexo dela.
 *
 * ANTES (achado do parecer Codex, 16/08): o painel apagava a resposta DIRETO do navegador
 * (`responses-dashboard.tsx`, `supabase.from('responses').delete()`). Não existia rota de
 * servidor nenhuma — então nada purgava o arquivo. A resposta sumia da tela e o documento do
 * lead continuava no storage, com a ficha ativa e o link funcionando.
 *
 * Isso contradizia a política publicada (`/privacidade`), que promete exclusão de dados. E a
 * correção não podia ser só "chamar a purga no cliente": purgar exige service-role, que nunca
 * pode ir para o navegador.
 *
 * ORDEM (a mesma lição do P0 de hoje): autenticar → provar a propriedade → só então destruir.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // PROVA DE PROPRIEDADE: a resposta pertence a um formulário DESTE usuário? O join com `forms`
  // é o que impede apagar resposta alheia sabendo só o id.
  const { data: resposta, error } = await supabase
    .from('responses')
    .select('id, form_id, forms!inner(user_id)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    logError('[responses/delete] falha ao ler a resposta', error, { id })
    return NextResponse.json({ error: 'Erro ao excluir' }, { status: 500 })
  }
  // 404 (não 403) para não confirmar a existência de resposta alheia.
  if (!resposta) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const dono = (resposta as unknown as { forms?: { user_id?: string } }).forms?.user_id
  if (dono !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ANEXOS PRIMEIRO. Depois do delete a linha some e, com ela, a chance de achar o arquivo pelo
  // response_id — o objeto ficaria vivo no storage sem ninguém para reclamá-lo.
  const purga = await purgarAnexos(createServiceRoleClient(), { responseId: id })

  const { error: erroDelete } = await supabase.from('responses').delete().eq('id', id)
  if (erroDelete) {
    // Anexos já revogados e a resposta continua. Estado seguro: o link morreu, o dado ficou.
    logError('[responses/delete] anexos purgados mas a resposta NÃO foi apagada', erroDelete, { id })
    return NextResponse.json({ error: 'Erro ao excluir' }, { status: 500 })
  }

  log('[responses/delete] resposta e anexos removidos', { id, ...purga })
  return NextResponse.json({ ok: true, anexos: purga })
}
