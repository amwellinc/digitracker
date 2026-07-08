import { AuthProvider } from '@/features/auth/AuthContext'
import { AppRouter } from './Router'

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}
