import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useRealtime } from '@/hooks/useRealtime'
import { Avatar } from '@/components/ui/Avatar'
import type { User } from '@/types'
import { UserActivityDrawer } from './UserActivityDrawer'

type Member = User & { isOnline: boolean }

export function TeamAvatarRow() {
  const { user } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState<Member | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('sub_account', user.sub_account)
      .order('name')

    const { data: active } = await supabase
      .from('time_logs')
      .select('user_id')
      .eq('date', today)
      .in('status', ['working', 'lunch'])

    const onlineIds = new Set((active ?? []).map((r: { user_id: string }) => r.user_id))

    setMembers((users ?? []).map((u: User) => ({ ...u, isOnline: onlineIds.has(u.id) })))
  }, [user])

  useEffect(() => { void load() }, [load])

  const handleInsert = useCallback(() => { void load() }, [load])
  const handleUpdate = useCallback(() => { void load() }, [load])

  useRealtime({ table: 'time_logs', onInsert: handleInsert, onUpdate: handleUpdate })

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-500 mb-4">Team Status</p>
        <div className="flex items-center gap-5 flex-wrap">
          {members.map(m => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="flex flex-col items-center gap-1.5 group"
            >
              <Avatar name={m.name} imageUrl={m.profile_image} size="lg" online={m.isOnline} />
              <span className="text-xs text-gray-600 max-w-[56px] truncate">
                {m.name.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected && <UserActivityDrawer user={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
