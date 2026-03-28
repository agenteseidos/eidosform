import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestUser } from '@/lib/supabase/request-auth'

type RouteParams = {
  params: Promise<{ id: string }>
}

interface MoveFormBody {
  folder_id?: string | null
}

// PATCH /api/forms/[id]/folder — move form to folder or remove from folder
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const user = await getRequestUser(req)
  const { id } = await params

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as MoveFormBody
  const folderId = body.folder_id ?? null

  const { data: form } = await supabase
    .from('forms')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!form) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  if (folderId !== null) {
    const { data: folder } = await supabase
      .from('folders')
      .select('id')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .single()

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }
  }

  const { data, error } = await supabase
    .from('forms')
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ form: data })
}
