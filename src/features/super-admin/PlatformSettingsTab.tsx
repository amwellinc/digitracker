import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { User } from '@/types'

const PLATFORM_SUB_ACCOUNT = '__saas__'

// supabase-js doesn't parse a Functions error response body into `error.message` —
// the real message lives on `error.context` (the raw Response). Same helper as UsersTab.
async function extractFunctionError(error: unknown, data: unknown): Promise<string | undefined> {
  if (!error) return (data as { error?: string } | null)?.error
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: string }
      if (body?.error) return body.error
    } catch {
      // fall through to generic message below
    }
  }
  return (error as { message?: string }).message ?? 'Failed to set password.'
}

interface SmtpSettings {
  id?: string
  smtp_host: string
  smtp_port: string
  smtp_secure: boolean
  smtp_user: string
  smtp_pass: string
  from_email: string
  from_name: string
}

const empty = (): SmtpSettings => ({
  smtp_host: '', smtp_port: '587', smtp_secure: false,
  smtp_user: '', smtp_pass: '', from_email: '', from_name: '',
})

export function PlatformSettingsTab() {
  const { user } = useAuth()
  const [form, setForm]       = useState<SmtpSettings>(empty())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [msg, setMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Super Admins ─────────────────────────────────────────────────────────
  const [superAdmins, setSuperAdmins] = useState<User[]>([])
  const [loadingAdmins, setLoadingAdmins] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [passwordUser, setPasswordUser] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchSuperAdmins = useCallback(async () => {
    setLoadingAdmins(true)
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('sub_account', PLATFORM_SUB_ACCOUNT)
      .eq('role', 'Super-Admin')
      .order('created_at', { ascending: true })
    setSuperAdmins((data as User[]) ?? [])
    setLoadingAdmins(false)
  }, [])

  useEffect(() => { void fetchSuperAdmins() }, [fetchSuperAdmins])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true); setInviteMsg(null)
    const email = inviteEmail.toLowerCase().trim()

    const { error } = await supabase.from('users').insert({
      name: inviteName.trim(),
      email,
      role: 'Super-Admin',
      sub_account: PLATFORM_SUB_ACCOUNT,
      manager_id: null,
      annual_leave: 0,
      time_off: 0,
      reporting_time_in: '09:00',
      reporting_time_out: '18:00',
      country: 'SG',
      phone: null,
    })
    if (error) {
      setInviting(false)
      setInviteMsg({ type: 'error', text: error.message })
      return
    }

    const { error: inviteError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setInviting(false)
    setInviteMsg(inviteError
      ? { type: 'error', text: `${inviteName} added, but the invite email failed to send: ${inviteError.message}. Use "Set Password" below instead.` }
      : { type: 'success', text: `${inviteName} added and invited — check ${email} for a magic link. They should choose "Platform" when signing in.` }
    )
    void fetchSuperAdmins()
    setInviteName(''); setInviteEmail('')
    setTimeout(() => { setShowInvite(false); setInviteMsg(null) }, 2500)
  }

  function openSetPassword(u: User) {
    setPasswordUser(u)
    setNewPassword(''); setConfirmPassword(''); setPwMsg(null)
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordUser) return
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    if (newPassword.length < 8) {
      setPwMsg({ type: 'error', text: 'Password must be at least 8 characters.' })
      return
    }
    setSettingPassword(true); setPwMsg(null)
    const { data, error } = await supabase.functions.invoke('admin-set-password', {
      body: { targetUserId: passwordUser.id, password: newPassword },
    })
    setSettingPassword(false)
    const fnError = await extractFunctionError(error, data)
    if (fnError) {
      setPwMsg({ type: 'error', text: fnError })
      return
    }
    setPwMsg({ type: 'success', text: `Password set for ${passwordUser.name}. They can sign in via "Platform" with email + password.` })
    setNewPassword(''); setConfirmPassword('')
    setTimeout(() => { setPasswordUser(null); setPwMsg(null) }, 3000)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('platform_settings')
        .select('*')
        .limit(1)
        .maybeSingle()
      if (data) {
        setForm({
          id:          data.id,
          smtp_host:   data.smtp_host   ?? '',
          smtp_port:   String(data.smtp_port ?? 587),
          smtp_secure: data.smtp_secure ?? false,
          smtp_user:   data.smtp_user   ?? '',
          smtp_pass:   data.smtp_pass   ?? '',
          from_email:  data.from_email  ?? '',
          from_name:   data.from_name   ?? '',
        })
      }
      setLoading(false)
    }
    void load()
  }, [])

  function patch<K extends keyof SmtpSettings>(key: K, val: SmtpSettings[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true); setMsg(null)

    const payload = {
      smtp_host:   form.smtp_host.trim(),
      smtp_port:   Number(form.smtp_port),
      smtp_secure: form.smtp_secure,
      smtp_user:   form.smtp_user.trim(),
      smtp_pass:   form.smtp_pass,
      from_email:  form.from_email.trim(),
      from_name:   form.from_name.trim(),
      updated_at:  new Date().toISOString(),
      updated_by:  user.id,
    }

    let error
    if (form.id) {
      ({ error } = await supabase.from('platform_settings').update(payload).eq('id', form.id))
    } else {
      const { data, error: insertErr } = await supabase
        .from('platform_settings').insert(payload).select().single()
      error = insertErr
      if (data) setForm(f => ({ ...f, id: (data as { id: string }).id }))
    }

    setSaving(false)
    setMsg(error
      ? { type: 'error', text: error.message }
      : { type: 'success', text: 'Settings saved. Now update the same SMTP details in your Supabase Auth dashboard to send branded auth emails.' }
    )
  }

  async function handleTest() {
    setTesting(true); setMsg(null)
    // Validate fields are filled before "testing"
    if (!form.smtp_host || !form.smtp_user || !form.smtp_pass || !form.from_email) {
      setMsg({ type: 'error', text: 'Fill in all SMTP fields before testing.' })
      setTesting(false)
      return
    }
    // Real SMTP test requires a backend function — here we verify the fields look valid
    // and remind the user to test via Supabase dashboard
    await new Promise(r => setTimeout(r, 600))
    setTesting(false)
    setMsg({
      type: 'success',
      text: `Settings look valid. To confirm delivery, send a test email from the Supabase Auth dashboard after entering these details there.`,
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* Super Admins section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Super Admins</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Platform-level developer accounts with access to every sub-account. Grant this only to your own team.
            </p>
          </div>
          <button
            onClick={() => { setShowInvite(true); setInviteMsg(null) }}
            className="flex items-center gap-1.5 bg-violet-600 text-white rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-violet-700 transition-colors flex-shrink-0"
          >
            <span className="text-base leading-none">+</span> Invite Super Admin
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loadingAdmins ? (
            <div className="flex items-center justify-center h-24 text-sm text-gray-400">Loading…</div>
          ) : superAdmins.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No Super Admins yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {superAdmins.map(sa => (
                <div key={sa.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {sa.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {sa.name}
                        {sa.id === user?.id && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{sa.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => openSetPassword(sa)}
                    className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md px-3 py-1.5 transition-colors flex-shrink-0"
                  >
                    🔑 Set Password
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SMTP section */}
      <section>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">Email & SMTP</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure your outbound email server. These settings are saved here and must also
            be entered in your Supabase project to send branded auth emails (password resets, magic links).
          </p>
        </div>

        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
              <input
                required
                value={form.smtp_host}
                onChange={e => patch('smtp_host', e.target.value)}
                placeholder="smtp.gmail.com"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
              <input
                required
                type="number"
                value={form.smtp_port}
                onChange={e => patch('smtp_port', e.target.value)}
                placeholder="587"
                className="input"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="smtp_secure"
              checked={form.smtp_secure}
              onChange={e => patch('smtp_secure', e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
            <label htmlFor="smtp_secure" className="text-sm text-gray-700">
              Use SSL/TLS (port 465) — disable for STARTTLS (port 587)
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Username</label>
            <input
              required
              type="email"
              value={form.smtp_user}
              onChange={e => patch('smtp_user', e.target.value)}
              placeholder="you@yourdomain.com"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Password</label>
            <div className="relative">
              <input
                required
                type={showPass ? 'text' : 'password'}
                value={form.smtp_pass}
                onChange={e => patch('smtp_pass', e.target.value)}
                placeholder="App password or SMTP password"
                className="input pr-16"
              />
              <button
                type="button"
                onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              For Gmail/Google Workspace: use an App Password, not your account password.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Name</label>
              <input
                required
                value={form.from_name}
                onChange={e => patch('from_name', e.target.value)}
                placeholder="DIGITRACKER"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Email</label>
              <input
                required
                type="email"
                value={form.from_email}
                onChange={e => patch('from_email', e.target.value)}
                placeholder="noreply@yourdomain.com"
                className="input"
              />
            </div>
          </div>

          {msg && (
            <div className={`rounded-lg px-4 py-3 text-sm ${
              msg.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {msg.text}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="text-sm font-medium text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {testing ? 'Checking…' : 'Validate Settings'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </form>
      </section>

      {/* Supabase setup guide */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-gray-900">Supabase Auth Email Setup</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Enter the same SMTP details in your Supabase project so password resets and auth emails
            come from your branded domain — not Supabase's default address.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-medium text-amber-800">Step-by-step: Configure SMTP in Supabase</p>
          <ol className="text-sm text-amber-700 space-y-1.5 list-decimal list-inside">
            <li>Go to your Supabase dashboard → <strong>Authentication</strong> → <strong>Settings</strong></li>
            <li>Scroll to <strong>SMTP Settings</strong> and enable <strong>Custom SMTP</strong></li>
            <li>Enter the same Host, Port, Username, Password, From Name, and From Email from above</li>
            <li>Click <strong>Save</strong> — all auth emails (password reset, magic links) will now use your domain</li>
          </ol>
          <a
            href="https://supabase.com/dashboard/project/mllrjejqyddgaxxtjsqf/auth/smtp"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-900"
          >
            Open Supabase Auth Settings →
          </a>
        </div>
      </section>

      {/* Auth settings section */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-gray-900">Auth Configuration Checklist</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Recommended Supabase Auth settings for this app.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {[
            {
              label: 'Enable Email + Password sign-in',
              note: 'Authentication → Settings → Email Auth → enable "Email and Password"',
              status: 'required',
            },
            {
              label: 'Disable "Confirm email" (optional)',
              note: 'Allows users to sign in immediately after password reset without re-confirming. Authentication → Settings → Email Auth → uncheck "Confirm email"',
              status: 'optional',
            },
            {
              label: 'Enable Magic Link (OTP) as fallback',
              note: 'Keep enabled for users who need access before setting a password. Authentication → Settings → Email Auth',
              status: 'recommended',
            },
            {
              label: 'Set app URL for redirects',
              note: `Authentication → URL Configuration → Site URL → set to your GitHub Pages URL`,
              status: 'required',
            },
          ].map(item => (
            <div key={item.label} className="flex items-start gap-3 px-5 py-4">
              <span className={`mt-0.5 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                item.status === 'required'    ? 'bg-red-100 text-red-700' :
                item.status === 'recommended' ? 'bg-violet-100 text-violet-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {item.status}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invite Super Admin modal */}
      {showInvite && (
        <Modal title="Invite Super Admin" onClose={() => setShowInvite(false)}>
          <p className="text-xs text-gray-500 mb-4">
            Grants full platform access across every sub-account — payments, plans, SMTP, and every workspace's data.
          </p>
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                required
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Jane Developer"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                required
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="jane@digi5y.com"
                className="input"
              />
            </div>
            {inviteMsg && (
              <p className={`text-sm ${inviteMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{inviteMsg.text}</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowInvite(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={inviting} className="btn-primary">
                {inviting ? 'Adding…' : 'Add & Invite'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Set Password modal */}
      {passwordUser && (
        <Modal title="Set Password" onClose={() => setPasswordUser(null)}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-purple-100 text-purple-700 font-bold text-lg flex items-center justify-center flex-shrink-0">
              {passwordUser.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{passwordUser.name}</p>
              <p className="text-sm text-gray-500">{passwordUser.email}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Sets a password this Super Admin can sign in with immediately — no magic-link email required.
            Share it with them directly (phone, in person, etc.).
          </p>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                required type="text" autoComplete="new-password"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters" className="input font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                required type="text" autoComplete="new-password"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat the password" className="input font-mono"
              />
            </div>
            {pwMsg && <p className={`text-sm ${pwMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{pwMsg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setPasswordUser(null)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={settingPassword} className="btn-primary">
                {settingPassword ? 'Setting…' : 'Set Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  )
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
