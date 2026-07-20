import { useNavigate } from 'react-router-dom'

const FEATURES = [
  {
    icon: '⏱',
    title: 'Live Time Tracking',
    desc: 'Clock in/out with real-time heartbeat monitoring. Automatic stale-session detection keeps hours accurate even if the browser closes.',
  },
  {
    icon: '📸',
    title: 'Screen Capture Audit',
    desc: 'Random screenshots taken between the 11th–18th minute of each session. Proof of work built into the workflow — no manual uploads.',
  },
  {
    icon: '📊',
    title: 'Live Team Dashboard',
    desc: 'Admin sees every team member\'s status, hours worked, and last heartbeat in real time. No refresh needed — powered by Supabase Realtime.',
  },
  {
    icon: '📋',
    title: 'Leave & Time Off',
    desc: 'Staff submit leave requests in-app. Managers approve or decline with a single click. Balances update automatically.',
  },
  {
    icon: '✅',
    title: 'Tasks & KPIs',
    desc: 'Assign tasks, set daily KPI targets, and require staff to submit daily updates before clocking out. Accountability built in.',
  },
  {
    icon: '🏢',
    title: 'Multi-Account Ready',
    desc: 'One platform, multiple sub-accounts. Super-admins can visit any account without separate logins. Ideal for agencies and franchises.',
  },
]

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white font-sans">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-md bg-[#0a0d14]/80">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="DIGITRACKER" className="w-8 h-8 rounded-lg object-contain" />
            <span className="font-bold tracking-tight text-sm">DIGITRACKER</span>
            <span className="text-xs text-white/30 hidden sm:inline ml-1">by DIGI5Y</span>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors"
          >
            Sign In
          </button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Gradient orb */}
        <div
          aria-hidden="true"
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }}
        />

        <div className="relative max-w-4xl mx-auto px-5 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" aria-hidden="true" />
            Remote Workforce Management
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.08] mb-6">
            Your team,{' '}
            <span className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #a78bfa 0%, #818cf8 100%)' }}>
              tracked in real time.
            </span>
          </h1>

          <p className="text-lg text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
            DIGITRACKER gives managers complete visibility over remote staff — time logs,
            screen captures, KPI submissions, and leave requests in one place.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold text-sm transition-colors shadow-lg shadow-violet-600/25"
            >
              Sign In to Dashboard
            </button>
            <a
              href="#features"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl border border-white/15 hover:border-white/30 font-semibold text-sm transition-colors text-white/80 hover:text-white text-center"
            >
              See Features
            </a>
          </div>
        </div>

        {/* Subtle divider */}
        <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </section>

      {/* ── Stats strip ── */}
      <section className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-5 py-10 grid grid-cols-3 gap-6 text-center">
          {[
            { value: '2 min', label: 'Heartbeat interval' },
            { value: 'Real-time', label: 'Team status updates' },
            { value: '3-tier', label: 'Role access control' },
          ].map(s => (
            <div key={s.label}>
              <div className="text-2xl sm:text-3xl font-black text-violet-400">{s.value}</div>
              <div className="text-xs text-white/40 mt-1 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Everything in one platform</h2>
            <p className="text-white/50 text-sm max-w-lg mx-auto">
              Built for remote-first teams that need accountability without micromanagement.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-violet-500/30 p-6 transition-all duration-200"
              >
                <div className="text-2xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-sm mb-2">{f.title}</h3>
                <p className="text-xs text-white/50 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="py-16 border-t border-white/10">
        <div className="max-w-4xl mx-auto px-5">
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-8 sm:p-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">Built for distributed teams</h2>
            <p className="text-white/60 text-sm max-w-xl mx-auto mb-8 leading-relaxed">
              Whether you manage 5 or 500 remote staff across multiple companies,
              DIGITRACKER gives you the visibility and control you need — without
              spreadsheets or manual timesheets.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="px-8 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold text-sm transition-colors shadow-lg shadow-violet-600/25"
            >
              Access Your Dashboard
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10 py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/30">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="w-5 h-5 rounded object-contain" aria-hidden="true" />
            <span>DIGITRACKER by DIGI5Y</span>
          </div>
          <span>© {new Date().getFullYear()} DIGI5Y. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
