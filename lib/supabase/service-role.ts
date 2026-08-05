import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/lib/database.types'

/**
 * Cliente SERVICE-ROLE (bypassa RLS). Renomeado de createPublicClient em
 * 05/08 (faxina; apontado pelo Codex 29/07): o nome antigo sugeria cliente
 * anônimo/público quando na verdade carrega a service_role_key — em rota de
 * segurança, nome que mente é bug latente. Usado nos caminhos públicos do
 * PRODUTO (player, submissão) onde não há auth de usuário e a rota é quem
 * aplica as regras de acesso.
 */
export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase environment variables for public client.\n' +
      'Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
