import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  projectId: string
  onInvited: () => void
}

type InviteResult = { status?: 'invited' | 'added' | 'already_member'; error?: string }

// supabase-js wraps non-2xx responses in a FunctionsHttpError whose
// `context` is the raw Response — read the function's own error message.
async function readFunctionError(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.json() as { error?: string }
      if (body.error) return body.error
    } catch { /* fall through */ }
  }
  return error.message
}

export function InviteAssociateForm({ projectId, onInvited }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('invite-associate', { body: { projectId, email, name } })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: await readFunctionError(error) }); return }

    const result = (data ?? {}) as InviteResult
    const text =
      result.status === 'invited' ? `${name} invited — a sign-in link was sent to ${email}.`
      : result.status === 'already_member' ? `${email} is already in this project.`
      : `${name} added to this project and notified.`
    setMsg({ type: result.error ? 'error' : 'success', text: result.error ? `${text} ${result.error}` : text })
    setEmail('')
    setName('')
    onInvited()
  }

  return (
    <form onSubmit={handleSubmit} className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-800">Invite associate (outside collaborator — project access only)</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Associate email" aria-label="Associate email" className="input flex-1" />
        <input required value={name} onChange={e => setName(e.target.value)}
          placeholder="Full name" aria-label="Associate full name" className="input flex-1" />
        <button type="submit" disabled={busy}
          className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-md px-3 py-2">
          {busy ? 'Inviting…' : 'Invite associate'}
        </button>
      </div>
      {msg && <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  )
}
