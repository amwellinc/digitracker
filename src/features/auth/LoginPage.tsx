import { Link } from 'react-router-dom'
import { AuthForm } from './AuthForm'

const SIGNUP_URL = 'https://digitracker.digi5y.co/#pricing'

const PANEL_FEATURES = [
  { icon: '⏱', title: 'Live Time Tracking', desc: 'Clock in/out with real-time heartbeat monitoring.' },
  { icon: '📸', title: 'Screen Capture Audit', desc: 'Automatic proof-of-work screenshots, built in.' },
  { icon: '📊', title: 'Live Team Dashboard', desc: 'See every status and hour update in real time.' },
  { icon: '📋', title: 'Leave & Task Management', desc: 'Approvals, KPIs, and accountability in one place.' },
]

export function LoginPage() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2 bg-white">

      {/* ── Branding panel — desktop only ── */}
      <div className="hidden lg:flex relative flex-col justify-between bg-[#0a0d14] text-white px-12 py-14 overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -top-32 -left-24 w-[560px] h-[560px] rounded-full opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }}
        />

        <div className="relative flex items-center gap-2.5">
          <img src="/logo.png" alt="DIGITRACKER" className="w-9 h-9 rounded-lg object-contain" />
          <div className="leading-tight">
            <span className="font-bold tracking-tight text-sm block">DIGITRACKER</span>
            <span className="text-xs text-white/40">by DIGI5Y</span>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl xl:text-4xl font-black tracking-tight leading-[1.15] mb-5">
            Your team,{' '}
            <span className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #a78bfa 0%, #818cf8 100%)' }}>
              tracked in real time.
            </span>
          </h1>
          <p className="text-white/50 text-sm leading-relaxed mb-10">
            Complete visibility over remote staff — time logs, screen captures,
            KPI submissions, and leave requests in one place.
          </p>

          <div className="space-y-5">
            {PANEL_FEATURES.map(f => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0 mt-0.5">{f.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-white/90">{f.title}</p>
                  <p className="text-xs text-white/40 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/30">
          © {new Date().getFullYear()} DIGI5Y. All rights reserved.
        </p>
      </div>

      {/* ── Sign-in panel ── */}
      <div className="flex flex-col min-h-screen lg:min-h-0">
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-sm">

            {/* Compact logo — mobile only, since the branding panel is hidden below lg */}
            <div className="flex lg:hidden flex-col items-center mb-8">
              <img src="/logo.png" alt="DIGITRACKER" className="w-16 h-16 object-contain mb-2" />
              <h1 className="text-xl font-bold tracking-tight text-gray-900">DIGITRACKER</h1>
              <p className="text-xs text-gray-400 mt-0.5">by DIGI5Y</p>
            </div>

            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
              <p className="text-sm text-gray-500 mt-1">Sign in to your DIGITRACKER account.</p>
            </div>

            <AuthForm accountType="team" />

            <div className="mt-7 pt-6 border-t border-gray-100 text-center space-y-3">
              <p className="text-sm text-gray-500">
                New to DIGITRACKER?
              </p>
              <a
                href={SIGNUP_URL}
                className="block w-full py-2.5 rounded-lg border border-violet-200 text-violet-700 text-sm font-semibold hover:bg-violet-50 transition-colors"
                style={{ minHeight: '44px', lineHeight: '1.25rem', paddingTop: '0.7rem' }}
              >
                Create an account →
              </a>
            </div>
          </div>
        </div>

        <footer className="px-4 py-5 text-center">
          <Link to="/" className="text-xs text-gray-400 hover:text-violet-600 transition-colors">
            Know more about DIGITRACKER by DIGI5Y →
          </Link>
        </footer>
      </div>
    </div>
  )
}
