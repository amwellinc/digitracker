import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Notification } from '@/types'
import { notifIcon } from './notifIcon'

export function NotificationsBell() {
  const { user } = useAuth()
  const channelId = useId()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!user) return
    const { data } = await supabase.from('notifications').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
    setItems((data ?? []) as Notification[])
  }, [user])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`notifications-bell:${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load, channelId])

  const unread = items.filter(n => !n.read).length

  async function markAllRead() {
    if (!user || unread === 0) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setItems(prev => prev.map(n => ({ ...n, read: true })))
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label={`Notifications (${unread} unread)`}
        className="relative w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center">
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            <button onClick={() => void markAllRead()} className="text-xs text-violet-600 hover:text-violet-800">Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {items.length === 0 && <li className="px-4 py-6 text-sm text-gray-400 text-center">No notifications yet</li>}
            {items.map(n => (
              <li key={n.id} className={`px-4 py-3 text-sm flex gap-2 ${n.read ? 'text-gray-500' : 'text-gray-900 bg-violet-50/40'}`}>
                <span aria-hidden="true">{notifIcon(n.type)}</span>
                {n.project_id
                  ? <Link to={`/projects/${n.project_id}`} onClick={() => setOpen(false)} className="hover:underline">{n.message}</Link>
                  : <span>{n.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
