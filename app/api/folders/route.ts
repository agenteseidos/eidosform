import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { Database } from '@/lib/database.types'

type FolderInsert = Database['public']['Tables']['folders']['Insert']

function normalizeFolderName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : ''
}

// GET /api/folders — list user folders
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ folders: data })
}

// POST /api/folders — create new folder
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const name = normalizeFolderName(body?.name)

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const insert: FolderInsert = {
    user_id: user.id,
    name,
  }

  const { data, error } = await supabase
    .from('folders')
    .insert(insert)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ folder: data }, { status: 201 })
}
