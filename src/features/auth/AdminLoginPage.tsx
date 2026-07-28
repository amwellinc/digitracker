import { Link } from 'react-router-dom'
import { AuthForm } from './AuthForm'

// Deliberately separate from /login and not linked from it — Platform Admin
// (DIGI5Y staff) access only, reached by direct URL.
export function AdminLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0d14] p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-2xl mb-4">
            🔒
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Platform Admin</h1>
          <p className="text-xs text-white/40 mt-1">DIGITRACKER by DIGI5Y — restricted access</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-black/30 p-6 sm:p-7 border border-white/5">
          <AuthForm accountType="platform" />
        </div>

        <div className="text-center mt-6">
          <Link to="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">
            ← Back to digitracker.digi5y.co
          </Link>
        </div>
      </div>
    </div>
  )
}
