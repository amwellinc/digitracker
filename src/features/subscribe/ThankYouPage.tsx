import { Link, useSearchParams } from 'react-router-dom'

export function ThankYouPage() {
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const isFree = searchParams.get('plan') === 'free'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#F8FAFF' }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-violet-50 text-3xl flex items-center justify-center mx-auto mb-5">
          🎉
        </div>
        <h1 className="font-heading text-2xl font-extrabold text-slate-900 mb-2">You're all set!</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {isFree
            ? "Your DIGITRACKER workspace is ready. Sign in with the email and password you just created to get started."
            : "Payment received — your DIGITRACKER workspace is ready. Sign in with the email and password you just created to get started."}
        </p>

        {code && (
          <div className="mt-5 border border-slate-200 rounded-lg px-4 py-3" style={{ background: '#F8FAFF' }}>
            <p className="text-xs text-slate-400">Your workspace code</p>
            <p className="font-mono font-semibold text-slate-800">{code}</p>
          </div>
        )}

        <Link
          to="/login"
          className="mt-7 inline-flex w-full items-center justify-center bg-violet-700 hover:bg-violet-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/30 text-white rounded-lg py-3 text-sm font-semibold transition-all"
          style={{ minHeight: '46px' }}
        >
          Go to Sign In →
        </Link>

        <p className="text-xs text-slate-400 mt-5">
          A confirmation email is on its way to your inbox.
        </p>
      </div>
    </div>
  )
}
