import { Link, useSearchParams } from 'react-router-dom'

const PRODUCT_WEBSITE = 'www.digitracker.co'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ThankYouPage() {
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const planName = searchParams.get('planName')
  const trialStart = searchParams.get('trialStart')
  const trialEnd = searchParams.get('trialEnd')

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#F8FAFF' }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-violet-50 text-3xl flex items-center justify-center mx-auto mb-5">
          🎉
        </div>
        <h1 className="font-heading text-2xl font-extrabold text-slate-900 mb-2">You're all set!</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          Your DIGITRACKER workspace is ready. We've emailed an invite link to activate your
          account and set your password — check your inbox to get started.
        </p>

        {/* Order summary — what was purchased */}
        <div className="mt-6 text-left rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          <SummaryRow label="Product" value="DIGITRACKER" />
          {planName && <SummaryRow label="Plan" value={planName} />}
          {code && <SummaryRow label="Workspace code" value={code} mono />}
          {trialStart && trialEnd && (
            <SummaryRow label="Trial period" value={`${fmtDate(trialStart)} – ${fmtDate(trialEnd)}`} />
          )}
          <SummaryRow label="Website" value={PRODUCT_WEBSITE} />
        </div>

        <Link
          to="/login"
          className="mt-7 inline-flex w-full items-center justify-center bg-violet-700 hover:bg-violet-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/30 text-white rounded-lg py-3 text-sm font-semibold transition-all"
          style={{ minHeight: '46px' }}
        >
          Go to Sign In →
        </Link>

        <p className="text-xs text-slate-400 mt-5">
          Didn't get the email? Check spam, or contact support once you're signed in.
        </p>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-medium text-slate-800 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
