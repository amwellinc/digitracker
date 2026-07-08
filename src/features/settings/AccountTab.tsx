import { useAuth } from '@/hooks/useAuth'

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-gray-100 last:border-0">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function AccountTab() {
  const { user } = useAuth()

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Account</h2>
        <p className="text-sm text-gray-500 mb-6">Your workspace configuration and identifiers.</p>

        <InfoRow label="Sub-account Code" value={user?.sub_account ?? '—'} />
        <InfoRow label="Role" value={user?.role ?? '—'} />
        <InfoRow label="Email" value={user?.email ?? '—'} />
        <InfoRow label="User ID" value={user?.id ?? '—'} mono />
        <InfoRow label="Supabase Project" value="mllrjejqyddgaxxtjsqf" mono />
        <InfoRow label="Application URL" value="https://digitracker.digi5y.co" mono />
        <InfoRow label="Member since" value={user?.created_at ? new Date(user.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'} />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4">
        <p className="text-sm text-amber-800 font-medium">⚠ Sub-account code is your company's unique identifier.</p>
        <p className="text-xs text-amber-700 mt-1">
          Share it with your team so they can log in. It cannot be changed after setup.
        </p>
      </div>
    </div>
  )
}
