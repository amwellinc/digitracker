import { useState, useRef, useEffect } from 'react'
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

  // Physical address + emergency contact — self-edited, saved separately
  // from the main profile form below.
  const [addressLine1, setAddressLine1] = useState(user?.address_line1 ?? '')
  const [addressLine2, setAddressLine2] = useState(user?.address_line2 ?? '')
  const [addressCity, setAddressCity] = useState(user?.address_city ?? '')
  const [addressPinCode, setAddressPinCode] = useState(user?.address_pin_code ?? '')
  const [emergencyName, setEmergencyName] = useState(user?.emergency_contact_name ?? '')
  const [emergencyPhone, setEmergencyPhone] = useState(user?.emergency_contact_phone ?? '')
  const [savingLocation, setSavingLocation] = useState(false)
  const [locationMsg, setLocationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Admin-assigned, read-only here: Manager and Department/Team names.
  const [managerName, setManagerName] = useState<string | null>(null)
  const [departmentName, setDepartmentName] = useState<string | null>(null)

  useEffect(() => {
    if (user?.manager_id) {
      void supabase.from('users').select('name').eq('id', user.manager_id).maybeSingle()
        .then(({ data }) => setManagerName((data as { name: string } | null)?.name ?? null))
    } else {
      setManagerName(null)
    }
  }, [user?.manager_id])

  useEffect(() => {
    if (user?.department_id) {
      void supabase.from('departments').select('name').eq('id', user.department_id).maybeSingle()
        .then(({ data }) => setDepartmentName((data as { name: string } | null)?.name ?? null))
    } else {
      setDepartmentName(null)
    }
  }, [user?.department_id])

  async function handleSaveLocation(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSavingLocation(true); setLocationMsg(null)
    const { error } = await supabase
      .from('users')
      .update({
        address_line1: addressLine1.trim() || null,
        address_line2: addressLine2.trim() || null,
        address_city: addressCity.trim() || null,
        address_pin_code: addressPinCode.trim() || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
      })
      .eq('id', user.id)
    setSavingLocation(false)
    if (!error) await refreshUser()
    setLocationMsg(error ? { type: 'error', text: error.message } : { type: 'success', text: 'Saved.' })
  }

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <input
                value={user?.role ?? ''}
                readOnly
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
              <input
                value={user?.id ?? ''}
                readOnly
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Appointed As</label>
              <input
                value={user?.appointed_as ?? ''}
                readOnly
                placeholder="Not set by your Admin yet"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager Assigned</label>
              <input
                value={managerName ?? ''}
                readOnly
                placeholder="No manager assigned"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department / Team</label>
            <input
              value={departmentName ?? ''}
              readOnly
              placeholder="Not assigned to a department yet"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300"
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

      {/* Location */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Location</h2>
        <p className="text-sm text-gray-500 mb-6">Your physical address, and the remote address your sessions are seen from.</p>

        <form onSubmit={handleSaveLocation} className="space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Physical Address</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
            <input
              value={addressLine1}
              onChange={e => setAddressLine1(e.target.value)}
              placeholder="Street address"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
            <input
              value={addressLine2}
              onChange={e => setAddressLine2(e.target.value)}
              placeholder="Apartment, unit, floor (optional)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                value={addressCity}
                onChange={e => setAddressCity(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pin Code</label>
              <input
                value={addressPinCode}
                onChange={e => setAddressPinCode(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Remote Address</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">IP Address</label>
            <input
              value={user?.last_ip_address ?? ''}
              readOnly
              placeholder="Not captured yet — sign in again to capture it"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed font-mono placeholder:font-sans placeholder:text-gray-300"
            />
            <p className="text-xs text-gray-400 mt-1">
              Captured automatically each time you sign in.
              {user?.last_ip_captured_at && (
                <> Last captured {new Date(user.last_ip_captured_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}.</>
              )}
            </p>
          </div>

          {locationMsg && (
            <p className={`text-sm ${locationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{locationMsg.text}</p>
          )}

          <button
            type="submit"
            disabled={savingLocation}
            className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {savingLocation ? 'Saving…' : 'Save Location'}
          </button>
        </form>
      </div>

      {/* Emergency Contact */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Emergency Contact</h2>
        <p className="text-sm text-gray-500 mb-6">Who we should reach out to in case of an emergency.</p>

        <form onSubmit={handleSaveLocation} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
              <input
                value={emergencyName}
                onChange={e => setEmergencyName(e.target.value)}
                placeholder="Full name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
              <input
                type="tel"
                value={emergencyPhone}
                onChange={e => setEmergencyPhone(e.target.value)}
                placeholder="91234567"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {locationMsg && (
            <p className={`text-sm ${locationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{locationMsg.text}</p>
          )}

          <button
            type="submit"
            disabled={savingLocation}
            className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {savingLocation ? 'Saving…' : 'Save Emergency Contact'}
          </button>
        </form>
      </div>
    </div>
  )
}
