import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useRealtime } from '@/hooks/useRealtime'

interface MessageRow { id: string; user_id: string; message: string; created_at: string; users: { name: string } | null }

export function DataAgentChat({ subAccount }: { subAccount: string }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('data_agent_chat_messages').select('id, user_id, message, created_at, users(name)')
      .eq('sub_account', subAccount).order('created_at')
    if (error) { setChatError('Could not load team chat.'); return }
    setMessages((data ?? []) as unknown as MessageRow[])
  }, [subAccount])

  useEffect(() => { void load() }, [load])
  useRealtime({ table: 'data_agent_chat_messages', filter: `sub_account=eq.${subAccount}`, onInsert: () => void load() })

  async function send() {
    if (!draft.trim() || !user?.id) return
    setSending(true); setChatError(null)
    const { error } = await supabase.from('data_agent_chat_messages').insert({ sub_account: subAccount, user_id: user.id, message: draft.trim() })
    setSending(false)
    // Keep the draft on failure — clearing it regardless of outcome would
    // silently drop the user's message with no way to retry it short of
    // retyping. Re-load explicitly on success rather than waiting on the
    // realtime round-trip, matching this feature's own established
    // belt-and-suspenders pattern (e.g. the per-column prompt feature's
    // askPrompt) — realtime still covers messages from other users.
    if (error) { setChatError('Could not send message.'); return }
    setDraft('')
    await load()
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Team Chat</h3>
      {chatError && <p role="alert" className="text-sm text-red-600">{chatError}</p>}
      <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
        {messages.map(m => (
          <div key={m.id} className="text-sm">
            <span className="font-medium text-gray-800">{m.users?.name}</span>
            <span className="text-gray-600 ml-2">{m.message}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input aria-label="message" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Message your team…" className="input flex-1" disabled={sending} />
        <button onClick={() => void send()} disabled={sending} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
