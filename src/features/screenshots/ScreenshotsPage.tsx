import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Screenshot, User } from '@/types'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr() {
  return todayInTz(DEFAULT_TIMEZONE)
}

function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return isoDate(d)
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
}

function fmtDateLabel(d: string) {
  return new Date(d).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

interface LightboxProps {
  shot: Screenshot
  total: number
  index: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

function Lightbox({ shot, total, index, onClose, onPrev, onNext }: LightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-6"
      onClick={onClose}
    >
      {/* Prev — always visible, positioned in overlay */}
      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); onPrev() }}
          disabled={index === 0}
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl flex items-center justify-center disabled:opacity-20 transition-colors"
          aria-label="Previous"
        >
          ‹
        </button>
      )}

      <div
        className="relative max-w-5xl w-full mx-10 sm:mx-16"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-9 right-0 text-white/70 hover:text-white text-3xl leading-none p-1"
          aria-label="Close"
        >
          &times;
        </button>

        {/* Image */}
        <img
          src={shot.url}
          alt="Screenshot"
          className="w-full rounded-xl shadow-2xl"
        />

        {/* Caption */}
        <div className="flex items-center justify-between mt-3 px-1 gap-2">
          <p className="text-white/60 text-xs sm:text-sm">{index + 1} / {total}</p>
          <p className="text-white text-xs sm:text-sm font-medium">{fmtTime(shot.timestamp)}</p>
          <a
            href={shot.url}
            download={`screenshot-${shot.timestamp}.jpg`}
            target="_blank"
            rel="noreferrer"
            className="text-white/60 hover:text-white text-xs sm:text-sm underline"
          >
            Download
          </a>
        </div>
      </div>

      {/* Next — always visible, positioned in overlay */}
      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNext() }}
          disabled={index === total - 1}
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl flex items-center justify-center disabled:opacity-20 transition-colors"
          aria-label="Next"
        >
          ›
        </button>
      )}
    </div>
  )
}

export function ScreenshotsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'

  const [members, setMembers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState(user?.id ?? '')
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [shots, setShots] = useState<Screenshot[]>([])
  const [fallbackDate, setFallbackDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // Load team members for admin / manager — managers see only their assigned staff
  useEffect(() => {
    if (!user || !canManage) return
    const q = supabase.from('users').select('*')
    const scoped = user.role === 'Manager'
      ? q.eq('manager_id', user.id)
      : q.eq('sub_account', user.sub_account)
    void scoped.order('name').then(({ data }) => setMembers((data ?? []) as User[]))
  }, [user, canManage])

  const loadShots = useCallback(async (uid: string, date: string) => {
    setLoading(true)
    setFallbackDate(null)

    const { data } = await supabase
      .from('screenshots')
      .select('*')
      .eq('user_id', uid)
      .eq('date', date)
      .order('timestamp', { ascending: false })

    const result = (data ?? []) as Screenshot[]

    // If today is selected and there are no shots, fall back to yesterday
    if (result.length === 0 && date === todayStr()) {
      const yesterday = yesterdayStr()
      const { data: prev } = await supabase
        .from('screenshots')
        .select('*')
        .eq('user_id', uid)
        .eq('date', yesterday)
        .order('timestamp', { ascending: false })
      setShots((prev ?? []) as Screenshot[])
      setFallbackDate(yesterday)
    } else {
      setShots(result)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedUserId) return
    void loadShots(selectedUserId, selectedDate)
  }, [selectedUserId, selectedDate, loadShots])

  // Realtime: refresh when a new screenshot is inserted for the selected user+date
  useEffect(() => {
    if (!selectedUserId) return
    const ch = supabase
      .channel('screenshots-realtime')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'screenshots',
        filter: `user_id=eq.${selectedUserId}`,
      }, () => void loadShots(selectedUserId, selectedDate))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [selectedUserId, selectedDate, loadShots])

  const selectedUser = canManage
    ? members.find(m => m.id === selectedUserId) ?? user
    : user

  const lastCapture = shots[0]?.timestamp
  const displayDate = fallbackDate ?? selectedDate

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Screenshots</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Automatically captured every 11–18 minutes while clocked in
        </p>
      </div>

      {/* Fallback banner */}
      {fallbackDate && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span>ℹ️</span>
          No screenshots captured today — showing <strong>{fmtDateLabel(fallbackDate)}</strong> instead
        </div>
      )}

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        {/* User selector — admin/manager only */}
        {canManage && members.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600 whitespace-nowrap">View:</label>
            <select
              value={selectedUserId}
              onChange={e => { setSelectedUserId(e.target.value); setLightboxIdx(null) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 min-h-[44px]"
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.id === user?.id ? '(You)' : `(${m.role})`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date picker */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Date:</label>
          <input
            type="date"
            value={selectedDate}
            max={todayStr()}
            onChange={e => { setSelectedDate(e.target.value); setLightboxIdx(null) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 min-h-[44px]"
          />
          {selectedDate !== todayStr() && (
            <button
              onClick={() => setSelectedDate(todayStr())}
              className="text-sm text-violet-600 hover:underline whitespace-nowrap"
            >
              Today
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="sm:ml-auto flex items-center gap-4 text-sm text-gray-500">
          <span>
            <span className="font-semibold text-gray-900">{shots.length}</span> capture{shots.length !== 1 ? 's' : ''}
          </span>
          {lastCapture && (
            <span>
              Last at <span className="font-medium text-gray-700">{fmtTime(lastCapture)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Date label */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {selectedUser && (
            <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
              {selectedUser.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-medium text-gray-700">
            {selectedUser?.name ?? '…'}
          </span>
        </div>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-500">{fmtDateLabel(displayDate)}</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : shots.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <span className="text-5xl mb-3">📸</span>
          <p className="text-base font-medium">No screenshots found</p>
          <p className="text-sm mt-1">
            {selectedDate === todayStr()
              ? 'Screenshots appear here once the user clocks in'
              : `No captures recorded for ${fmtDateLabel(selectedDate)}`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {shots.map((shot, i) => (
            <button
              key={shot.id}
              onClick={() => setLightboxIdx(i)}
              className="group relative aspect-video bg-gray-100 rounded-xl overflow-hidden hover:ring-2 hover:ring-violet-500 transition-all"
            >
              <img
                src={shot.url}
                alt={`Screenshot at ${fmtTime(shot.timestamp)}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {/* Time overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-white text-xs font-medium">{fmtTime(shot.timestamp)}</p>
              </div>
              {/* Index badge */}
              <div className="absolute top-1.5 right-1.5 bg-black/40 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                {shots.length - i}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && shots[lightboxIdx] && (
        <Lightbox
          shot={shots[lightboxIdx]}
          total={shots.length}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => setLightboxIdx(i => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIdx(i => (i !== null && i < shots.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  )
}
