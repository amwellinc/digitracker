import { Link } from 'react-router-dom'
import { AuthForm } from './AuthForm'

const MARKETING_SITE_URL = 'https://digitracker.digi5y.co'

const PANEL_FEATURES = [
  { icon: '⏱', title: 'Live Time Tracking', desc: 'Clock in/out with real-time heartbeat monitoring.' },
  { icon: '📸', title: 'Screen Capture Audit', desc: 'Automatic proof-of-work screenshots, built in.' },
  { icon: '📊', title: 'Live Team Dashboard', desc: 'See every status and hour update in real time.' },
  { icon: '📋', title: 'Leave & Task Management', desc: 'Approvals, KPIs, and accountability in one place.' },
]

export function LoginPage() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2 bg-white">

      {/* ── Branding panel — desktop only — light + violet, matching digitracker.digi5y.co ── */}
      <div
        className="hidden lg:flex relative flex-col justify-between px-12 py-14 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #F8FAFF 0%, #EEF2FF 100%)' }}
      >
        <div
          aria-hidden="true"
          className="absolute -top-32 -left-24 w-[560px] h-[560px] rounded-full opacity-40 pointer-events-none blur-3xl"
          style={{ background: 'radial-gradient(circle, #DDD6FE 0%, transparent 70%)' }}
        />

        <a href={MARKETING_SITE_URL} className="relative flex items-center gap-2.5 w-fit">
          <img src="/logo.png" alt="DIGITRACKER" className="w-9 h-9 rounded-lg object-contain" />
          <div className="leading-tight">
            <span className="font-heading font-extrabold tracking-tight text-sm block text-slate-900">DIGITRACKER</span>
            <span className="text-xs text-slate-400">by DIGI5Y</span>
          </div>
        </a>

        <div className="relative max-w-md">
          <h1 className="font-heading text-3xl xl:text-4xl font-extrabold tracking-tight leading-[1.15] mb-5 text-slate-900">
            Your team,{' '}
            <span className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #6D28D9 0%, #2563EB 100%)' }}>
              tracked in real time.
            </span>
          </h1>
          <p className="font-marketing-body text-slate-500 text-sm leading-relaxed mb-10">
            Complete visibility over remote staff — time logs, screen captures,
            KPI submissions, and leave requests in one place.
          </p>

          <div className="space-y-5">
            {PANEL_FEATURES.map(f => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0 mt-0.5">{f.icon}</span>
                <div>
                  <p className="font-marketing-body text-sm font-semibold text-slate-800">{f.title}</p>
                  <p className="font-marketing-body text-xs text-slate-400 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="font-marketing-body relative text-xs text-slate-400">
          © {new Date().getFullYear()} DIGI5Y. All rights reserved.
        </p>
      </div>

      {/* ── Sign-in panel ── */}
      <div className="flex flex-col min-h-screen lg:min-h-0">
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-sm">

            {/* Compact logo — mobile only, since the branding panel is hidden below lg */}
            <a href={MARKETING_SITE_URL} className="flex lg:hidden flex-col items-center mb-8">
              <img src="/logo.png" alt="DIGITRACKER" className="w-16 h-16 object-contain mb-2" />
              <h1 className="font-heading text-xl font-extrabold tracking-tight text-slate-900">DIGITRACKER</h1>
              <p className="text-xs text-slate-400 mt-0.5">by DIGI5Y</p>
            </a>

            <div className="mb-6">
              <h2 className="font-heading text-2xl font-bold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-1">Sign in to your DIGITRACKER account.</p>
            </div>

            <AuthForm accountType="team" />

            <div className="mt-7 pt-6 border-t border-slate-100 text-center space-y-3">
              <p className="text-sm text-slate-500">
                New to DIGITRACKER?
              </p>
              <Link
                to="/subscribe"
                className="block w-full py-2.5 rounded-lg border-2 border-slate-200 text-violet-700 text-sm font-semibold hover:border-violet-600 hover:bg-violet-50 transition-colors"
                style={{ minHeight: '44px', lineHeight: '1.25rem', paddingTop: '0.6rem' }}
              >
                Create an account →
              </Link>
            </div>
          </div>
        </div>

        <footer className="px-4 py-5 text-center">
          <a href={MARKETING_SITE_URL} className="text-xs text-slate-400 hover:text-violet-700 transition-colors">
            Know more about DIGITRACKER by DIGI5Y →
          </a>
        </footer>
      </div>
    </div>
  )
}
