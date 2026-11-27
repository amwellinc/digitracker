import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from '@/lib/timezone'
import { COUNTRY_OPTIONS } from '@/lib/constants'
import { invalidateTimezoneCache } from '@/hooks/useSubAccountTimezone'
import { updateBrandingCache } from '@/hooks/useSubAccountBranding'
import { DEFAULT_COLOR, isValidBrandColor } from '@/lib/theme'

const BRAND_COLORS = [
  { label: 'Blue', value: '#2563eb' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Orange', value: '#ea580c' },
]

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-gray-100 last:border-0">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

export function AccountTab() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [country, setCountry] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [companyName, setCompanyName] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandColor, setBrandColor] = useState(DEFAULT_COLOR)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [savingBranding, setSavingBranding] = useState(false)
  const [brandingMsg, setBrandingMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user?.sub_account || !isAdmin) return
    void supabase
      .from('sub_accounts')
      .select('timezone, country, company_name, logo_url, brand_color')
      .eq('code', user.sub_account)
      .single()
      .then(({ data }) => {
        if (!data) return
        const row = data as {
          timezone: string
          country: string | null
          company_name: string | null
          logo_url: string | null
          brand_color: string | null
        }
        setTimezone(row.timezone ?? DEFAULT_TIMEZONE)
        setCountry(row.country ?? '')
        setCompanyName(row.company_name ?? '')
        setLogoUrl(row.logo_url)
        setBrandColor(row.brand_color && isValidBrandColor(row.brand_color) ? row.brand_color : DEFAULT_COLOR)
      })
  }, [user?.sub_account, isAdmin])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.sub_account) return
    setSaving(true)
    const { error } = await supabase
      .from('sub_accounts')
      .update({ timezone, country: country || null })
      .eq('code', user.sub_account)
    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      invalidateTimezoneCache(user.sub_account)
      setMsg({ type: 'success', text: 'Country and work timezone saved. Calendars will now follow this timezone.' })
    }
  }

  function pickLogo(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setBrandingMsg({ type: 'error', text: 'Logo must be an image file.' })
      return
    }
    if (f.size > MAX_LOGO_BYTES) {
      setBrandingMsg({ type: 'error', text: 'Logo must be under 2 MB.' })
      return
    }
    setBrandingMsg(null)
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
  }

  async function handleSaveBranding(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.sub_account) return
    setSavingBranding(true)
    setBrandingMsg(null)

    let nextLogoUrl = logoUrl
    if (logoFile) {
      const ext = logoFile.name.split('.').pop() ?? 'png'
      const path = `_branding/${user.sub_account}/${Date.now()}-logo.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, logoFile, { contentType: logoFile.type })
      if (uploadError) {
        setSavingBranding(false)
        setBrandingMsg({ type: 'error', text: `Failed to upload logo: ${uploadError.message}` })
        return
      }
      nextLogoUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    const { error } = await supabase
      .from('sub_accounts')
      .update({
        company_name: companyName.trim(),
        logo_url: nextLogoUrl,
        brand_color: brandColor,
      })
      .eq('code', user.sub_account)
    setSavingBranding(false)
    if (error) {
      setBrandingMsg({ type: 'error', text: error.message })
      return
    }
    setLogoUrl(nextLogoUrl)
    setLogoFile(null)
    setLogoPreview(null)
    updateBrandingCache(user.sub_account, {
      companyName: companyName.trim() || null,
      logoUrl: nextLogoUrl,
      brandColor,
    })
    setBrandingMsg({ type: 'success', text: 'Workspace appearance saved for your team.' })
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Read-only workspace info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Account</h2>
        <p className="text-sm text-gray-500 mb-6">Your workspace configuration and identifiers.</p>

        <InfoRow label="Sub-account Code" value={user?.sub_account ?? '—'} />
        <InfoRow label="Email"            value={user?.email ?? '—'} />
        <InfoRow label="Supabase Project" value="mllrjejqyddgaxxtjsqf" mono />
        <InfoRow label="Application URL"  value="https://digitracker-app.digi5y.co" mono />
        <InfoRow
          label="Member since"
          value={
            user?.created_at
              ? new Date(user.created_at).toLocaleDateString('en-SG', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })
              : '—'
          }
        />
      </div>

      {/* Company branding — Admin / Super-Admin only */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Workspace Appearance</h2>
          <p className="text-sm text-gray-500 mb-5">
            Set your company name, logo, and accent color. These workspace settings are shared with
            everyone in your team.
          </p>
          <form onSubmit={handleSaveBranding} className="space-y-4">
            <div className="flex items-center gap-4">
              <div
                onClick={() => fileRef.current?.click()}
                className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 hover:border-violet-300 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 flex-shrink-0"
              >
                {logoPreview || logoUrl ? (
                  <img src={logoPreview ?? logoUrl!} alt="Logo preview" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-2xl text-gray-300">🏢</span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-sm font-medium text-violet-600 hover:text-violet-800"
                >
                  {logoUrl || logoPreview ? 'Change logo' : 'Upload logo'}
                </button>
                <p className="text-xs text-gray-400 mt-0.5">PNG, JPG, or SVG. Up to 2 MB.</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => pickLogo(e.target.files?.[0])}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank to keep showing "DIGITRACKER".</p>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-2">Workspace accent color</legend>
              <div className="flex flex-wrap items-center gap-3">
                {BRAND_COLORS.map(color => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.label}
                    aria-label={`${color.label} workspace color`}
                    aria-pressed={brandColor === color.value}
                    onClick={() => setBrandColor(color.value)}
                    style={{ backgroundColor: color.value }}
                    className={`w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                      brandColor === color.value ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : ''
                    }`}
                  />
                ))}
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <span>Custom</span>
                  <input
                    type="color"
                    value={brandColor}
                    aria-label="Custom workspace accent color"
                    onChange={e => setBrandColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setBrandColor(DEFAULT_COLOR)}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Reset
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Updates buttons, navigation, and highlights across the workspace after saving.
              </p>
              <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-2">Preview</p>
                <div className="flex items-center gap-3">
                  <span
                    style={{ backgroundColor: brandColor }}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Primary action
                  </span>
                  <span style={{ color: brandColor }} className="text-sm font-medium">Link</span>
                  <span
                    style={{ backgroundColor: `${brandColor}1a`, color: brandColor }}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  >
                    Status
                  </span>
                </div>
              </div>
            </fieldset>

            {brandingMsg && (
              <p className={`text-sm ${brandingMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {brandingMsg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={savingBranding}
              className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {savingBranding ? 'Saving…' : 'Save Workspace Appearance'}
            </button>
          </form>
        </div>
      )}

      {/* Country + Timezone — Admin / Super-Admin only */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Country &amp; Work Calendar Timezone</h2>
          <p className="text-sm text-gray-500 mb-5">
            Sets your workspace's country and the timezone used by all calendars in it. "Today" and
            date highlights will follow this timezone for every user in your sub-account.
          </p>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">— Not set —</option>
                {COUNTRY_OPTIONS.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.flag} {opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Current timezone: <span className="font-mono">{timezone}</span>
              </p>
            </div>

            {msg && (
              <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {msg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm text-amber-800 font-medium">⚠ Sub-account code is your company's unique identifier.</p>
        <p className="text-xs text-amber-700 mt-1">
          Share it with your team so they can log in. It cannot be changed after setup.
        </p>
      </div>
    </div>
  )
}
