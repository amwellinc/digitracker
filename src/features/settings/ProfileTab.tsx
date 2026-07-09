import { useState, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { UserCountry } from '@/types'
import { COUNTRY_OPTIONS } from '@/lib/constants'

export function ProfileTab() {
  const { user, refreshUser } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [timeIn, setTimeIn] = useState(user?.reporting_time_in ?? '10:00')
  const [timeOut, setTimeOut] = useState(user?.reporting_time_out ?? '19:00')
  const [country, setCountry] = useState<UserCountry>(user?.country ?? 'SG')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [avatarUrl, setAvatarUrl] = useState(user?.profile_image ?? '')
  const fileRef = useRef<HTMLInputElement>(null)

  const initials = (user?.name ?? 'U').slice(0, 2).toUpperCase()

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${user.id}/${user.id}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (upErr) { setMsg({ type: 'error', text: upErr.message }); setUploading(false); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = data.publicUrl
    await supabase.from('users').update({ profile_image: url }).eq('id', user.id)
    setAvatarUrl(url)
    setUploading(false)
    await refreshUser()
    setMsg({ type: 'success', text: 'Profile picture updated.' })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        reporting_time_in: timeIn,
        reporting_time_out: timeOut,
        country,
        phone: phone.trim() || null,
      })
      .eq('id', user.id)
    setSaving(false)
    if (!error) await refreshUser()
    setMsg(error ? { type: 'error', text: error.message } : { type: 'success', text: 'Profile saved.' })
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">My Profile</h2>
        <p className="text-sm text-gray-500 mb-6">Update your personal information and profile picture.</p>

        {/* Avatar */}
        <div className="flex items-center gap-5 mb-6">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-full object-cover border-2 border-gray-200" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-violet-200 text-violet-700 font-bold text-2xl flex items-center justify-center border-2 border-gray-200">
              {initials}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-sm font-medium text-violet-600 hover:text-violet-700 border border-violet-300 rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Change Photo'}
            </button>
            <p className="text-xs text-gray-400 mt-1">JPG, PNG up to 5MB</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value as UserCountry)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {COUNTRY_OPTIONS.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Used to apply the correct public holidays</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <div className="flex gap-2">
                <span className="inline-flex items-center px-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm select-none">
                  {COUNTRY_OPTIONS.find(c => c.code === country)?.dialCode ?? '+65'}
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="91234567"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clock-in Time</label>
              <input
                type="time"
                value={timeIn}
                onChange={e => setTimeIn(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clock-out Time</label>
              <input
                type="time"
                value={timeOut}
                onChange={e => setTimeOut(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {msg && (
            <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </form>
      </div>
    </div>
  )
}
