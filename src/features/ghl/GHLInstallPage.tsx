export function GHLInstallPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-violet-50/30 p-4 py-8">
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-lg shadow-gray-200/80 max-w-md w-full space-y-6 border border-gray-100">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <img src="/logo.png" alt="DIGITRACKER" className="w-16 h-16 object-contain mb-3" />
          <h1 className="text-2xl font-bold tracking-tight">DIGITRACKER</h1>
          <p className="text-xs text-gray-400 mt-0.5">By DIGI5Y · GoHighLevel Marketplace App</p>
        </div>

        {/* Feature list */}
        <div className="space-y-2 text-sm text-gray-600">
          {[
            'Time tracking & attendance with screen capture',
            'Task and KPI management',
            'Leave & schedule management',
            'HR document storage',
            'Real-time GHL contact sync',
            'Multi-role team access',
          ].map(f => (
            <div key={f} className="flex items-start gap-2.5">
              <span className="text-green-500 font-bold flex-shrink-0 mt-px">✓</span>
              <span>{f}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3 pt-1">
          <a
            href="/#/login"
            className="block w-full bg-violet-600 text-white text-sm font-semibold rounded-xl py-3 text-center hover:bg-violet-700 active:bg-violet-800 transition-colors"
          >
            Sign In to Connect
          </a>
          <p className="text-center text-xs text-gray-400">
            Need access?{' '}
            <a href="mailto:admin@digi5y.co" className="text-violet-600 hover:underline">
              Contact DIGI5Y
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
