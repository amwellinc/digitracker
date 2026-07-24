import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Department, User } from '@/types'

interface DepartmentRow extends Department {
  managerIds: string[]
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

export function DepartmentsTab() {
  const { user: currentUser } = useAuth()
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [managers, setManagers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editDept, setEditDept] = useState<DepartmentRow | null>(null)
  const [deleteDept, setDeleteDept] = useState<DepartmentRow | null>(null)

  const [name, setName] = useState('')
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    const [{ data: deptData }, { data: mgrData }, { data: linkData }] = await Promise.all([
      supabase.from('departments').select('*').eq('sub_account', currentUser.sub_account).order('name', { ascending: true }),
      supabase.from('users').select('*').eq('sub_account', currentUser.sub_account)
        .in('role', ['Manager', 'Admin']).eq('status', 'active'),
      supabase.from('department_managers').select('department_id, manager_id'),
    ])
    const links = (linkData as { department_id: string; manager_id: string }[]) ?? []
    const rows: DepartmentRow[] = ((deptData as Department[]) ?? []).map(d => ({
      ...d,
      managerIds: links.filter(l => l.department_id === d.id).map(l => l.manager_id),
    }))
    setDepartments(rows)
    setManagers((mgrData as User[]) ?? [])
    setLoading(false)
  }, [currentUser])

  useEffect(() => { void load() }, [load])

  function openAdd() {
    setName(''); setSelectedManagerIds([]); setMsg(null); setShowAddModal(true)
  }

  function openEdit(d: DepartmentRow) {
    setName(d.name); setSelectedManagerIds(d.managerIds); setMsg(null)
    setEditDept(d)
  }

  function toggleManager(id: string) {
    setSelectedManagerIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  async function syncManagerLinks(departmentId: string) {
    await supabase.from('department_managers').delete().eq('department_id', departmentId)
    if (selectedManagerIds.length > 0) {
      await supabase.from('department_managers').insert(
        selectedManagerIds.map(manager_id => ({ department_id: departmentId, manager_id }))
      )
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!currentUser) return
    setSaving(true); setMsg(null)
    const { data, error } = await supabase
      .from('departments')
      .insert({ sub_account: currentUser.sub_account, name: name.trim() })
      .select('id').single()
    if (error || !data) {
      setSaving(false)
      setMsg({ type: 'error', text: error?.message ?? 'Failed to create department.' })
      return
    }
    await syncManagerLinks((data as { id: string }).id)
    setSaving(false)
    setShowAddModal(false)
    void load()
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editDept) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('departments').update({ name: name.trim() }).eq('id', editDept.id)
    if (error) {
      setSaving(false)
      setMsg({ type: 'error', text: error.message })
      return
    }
    await syncManagerLinks(editDept.id)
    setSaving(false)
    setEditDept(null)
    void load()
  }

  async function handleDelete() {
    if (!deleteDept) return
    setDeleting(true)
    const { error } = await supabase.from('departments').delete().eq('id', deleteDept.id)
    setDeleting(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setDeleteDept(null)
    void load()
  }

  function managerNames(d: DepartmentRow) {
    const names = d.managerIds.map(id => managers.find(m => m.id === id)?.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : null
  }

  return (
    <div>
      {msg && !showAddModal && !editDept && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          {msg.text}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Departments / Teams</h2>
          <p className="text-sm text-gray-500">
            Create teams for this workspace and assign one or more Managers to each.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          <span className="text-lg leading-none">+</span> Add Department
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading departments…</div>
        ) : departments.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">No departments yet. Add your first team.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Department / Team</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Manager(s) Assigned</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {departments.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {managerNames(d) ?? <span className="text-gray-300">No manager assigned</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-1.5 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteDept(d)}
                        className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-md px-3 py-1.5 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(showAddModal || editDept) && (
        <Modal title={editDept ? `Edit — ${editDept.name}` : 'Add Department'} onClose={() => { setShowAddModal(false); setEditDept(null) }}>
          <form onSubmit={editDept ? handleEdit : handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department / Team Name</label>
              <input required value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Customer Support" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager(s) Assigned</label>
              {managers.length === 0 ? (
                <p className="text-xs text-gray-400">No active Managers or Admins in this workspace yet.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {managers.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedManagerIds.includes(m.id)}
                        onChange={() => toggleManager(m.id)}
                        className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span>{m.name} <span className="text-xs text-gray-400">({m.role})</span></span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">A department can have more than one Manager assigned.</p>
            </div>
            {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setShowAddModal(false); setEditDept(null) }} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : editDept ? 'Save Changes' : 'Add Department'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteDept && (
        <Modal title="Delete Department" onClose={() => setDeleteDept(null)}>
          <p className="text-sm text-gray-600 mb-1">
            Are you sure you want to delete <strong>{deleteDept.name}</strong>?
          </p>
          <p className="text-xs text-gray-400 mb-5">
            Users assigned to this department will keep their profile but show no Department / Team until reassigned.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteDept(null)} className="btn-ghost">Cancel</button>
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-red-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
