import { Link } from 'react-router-dom'

interface Props {
  title: string
  lastUpdated: string
  children: React.ReactNode
}

export function LegalPageLayout({ title, lastUpdated, children }: Props) {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #F8FAFF 0%, #FFFFFF 340px)' }}>
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="https://www.digitracker.co" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="DIGITRACKER" className="w-8 h-8 rounded-lg object-contain" />
            <span
              className="font-heading font-extrabold tracking-tight text-base text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #6D28D9 0%, #2563EB 100%)' }}
            >
              DIGITRACKER
            </span>
          </a>
          <Link to="/login" className="text-sm font-medium text-violet-700 hover:text-violet-800">
            Sign in →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
          {title}
        </h1>
        <p className="text-sm text-slate-400 mb-10">Last updated: {lastUpdated}</p>

        <div className="space-y-8 text-sm sm:text-base text-slate-600 leading-relaxed">
          {children}
        </div>

        <footer className="mt-16 pt-8 border-t border-slate-200 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/privacy" className="hover:text-violet-700 transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-violet-700 transition-colors">Terms of Service</Link>
          <a href="https://www.digitracker.co" className="hover:text-violet-700 transition-colors">www.digitracker.co</a>
          <a href="mailto:admin@digi5y.co" className="hover:text-violet-700 transition-colors">admin@digi5y.co</a>
        </footer>
      </main>
    </div>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-heading text-lg font-bold text-slate-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
