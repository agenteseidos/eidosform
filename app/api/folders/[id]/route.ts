import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestUser } from '@/lib/supabase/request-auth'

type RouteParams = {
  params: Promise<{ id: string }>
}

function normalizeFolderName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : ''
}

// PATCH /api/folders/[id] — rename folder
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const user = await getRequestUser(req)
  const { id } = await params

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const name = normalizeFolderName(body?.name)

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('folders')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('folders')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ folder: data })
}

// DELETE /api/folders/[id] — delete folder (forms become ungrouped)
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const user = await getRequestUser(req)
  const { id } = await params

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existing } = await supabase
    .from('folders')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
