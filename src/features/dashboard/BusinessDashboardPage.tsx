import { AdminDashboard } from './AdminDashboard'
import { MessageBoard } from '@/features/message-board/MessageBoard'

export function BusinessDashboardPage() {
  return (
    <div className="space-y-6">
      <MessageBoard />
      <AdminDashboard />
    </div>
  )
}
