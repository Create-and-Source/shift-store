import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

import { roleFromReq } from '../_lib/adminRole.js'

// The shared to do list between the two admin logins (owner = Tovah,
// staff = Jenna). Admin only at every verb, including GET: nothing here is
// ever public, unlike collections.
//
// The tables ship in supabase-todos.sql. Until that migration is run every
// route answers "no to dos" with setupNeeded rather than 500ing, so the tab
// renders a setup hint instead of an error.
function migrationMissing(error) {
  const m = String(error?.message || '')
  return /relation .*todos.* does not exist|Could not find the table/i.test(m)
}

const STATUSES = ['open', 'doing', 'done']
const WHO = ['owner', 'staff', 'both']

export default async function handler(req, res) {
  const role = roleFromReq(req)
  if (!role) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') {
    const { data: todos, error } = await supabase
      .from('todos')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      if (migrationMissing(error)) return res.status(200).json({ todos: [], attachments: [], setupNeeded: true })
      return res.status(500).json({ error: error.message })
    }

    const { data: attachments } = await supabase
      .from('todo_attachments')
      .select('*')
      .order('created_at', { ascending: true })

    return res.status(200).json({ todos: todos || [], attachments: attachments || [], role })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action } = req.body || {}

  try {
    switch (action) {
      // ── to dos ──────────────────────────────────────────────────────────
      case 'create': {
        const { title, body, assignedTo, dueDate } = req.body
        if (!title || !String(title).trim()) return res.status(400).json({ error: 'A to do needs a title' })
        // New rows go to the top of the list, so the newest ask is the one
        // you see first without anyone reordering anything.
        const { data: first } = await supabase
          .from('todos').select('sort_order').order('sort_order', { ascending: true }).limit(1)
        const sortOrder = (first?.[0]?.sort_order ?? 0) - 1
        const { data, error } = await supabase.from('todos').insert({
          title: String(title).trim(),
          body: body ? String(body) : null,
          created_by: role,
          // Written by one login, so it lands on the other one by default.
          assigned_to: WHO.includes(assignedTo) ? assignedTo : (role === 'owner' ? 'staff' : 'owner'),
          due_date: dueDate || null,
          sort_order: sortOrder,
        }).select().single()
        if (error) throw error
        return res.status(200).json({ todo: data })
      }

      case 'update': {
        const { id, title, body, assignedTo, dueDate } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const patch = { updated_at: new Date().toISOString() }
        if (title !== undefined) patch.title = String(title).trim()
        if (body !== undefined) patch.body = body === null ? null : String(body)
        if (assignedTo !== undefined && WHO.includes(assignedTo)) patch.assigned_to = assignedTo
        if (dueDate !== undefined) patch.due_date = dueDate || null
        const { error } = await supabase.from('todos').update(patch).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'setStatus': {
        const { id, status } = req.body
        if (!id || !STATUSES.includes(status)) return res.status(400).json({ error: 'id and a valid status required' })
        const { error } = await supabase.from('todos').update({
          status,
          updated_at: new Date().toISOString(),
          // done_at is cleared on reopen, so "finished on" never shows a date
          // from a previous time around.
          done_at: status === 'done' ? new Date().toISOString() : null,
        }).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'delete': {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        // Attachments go with it: todo_attachments cascades on delete.
        const { error } = await supabase.from('todos').delete().eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ── attachments ─────────────────────────────────────────────────────
      case 'addAttachment': {
        const { todoId, url, caption, kind } = req.body
        if (!todoId || !url) return res.status(400).json({ error: 'todoId and url required' })
        const { data, error } = await supabase.from('todo_attachments').insert({
          todo_id: todoId,
          url: String(url).trim(),
          caption: caption ? String(caption).trim() : null,
          kind: kind === 'result' ? 'result' : 'brief',
          added_by: role,
        }).select().single()
        if (error) throw error
        await supabase.from('todos').update({ updated_at: new Date().toISOString() }).eq('id', todoId)
        return res.status(200).json({ attachment: data })
      }

      case 'removeAttachment': {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await supabase.from('todo_attachments').delete().eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` })
    }
  } catch (err) {
    if (migrationMissing(err)) {
      return res.status(503).json({ error: 'Run supabase-todos.sql in the Supabase SQL editor first.' })
    }
    return res.status(500).json({ error: err.message })
  }
}
