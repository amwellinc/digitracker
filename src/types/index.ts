export type UserRole = 'Super-admin' | 'Manager' | 'Staff'

export type UserCountry = 'SG' | 'MY' | 'PH'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  sub_account: string
  manager_id: string | null
  annual_leave: number
  time_off: number
  profile_image: string | null
  reporting_time_in: string
  reporting_time_out: string
  country: UserCountry
  phone: string | null
  created_at: string
}

export interface TimeLog {
  id: string
  user_id: string
  date: string
  clock_in: string
  clock_out: string | null
  status: 'working' | 'lunch' | 'clocked_out'
  total_minutes: number
}

export interface Screenshot {
  id: string
  user_id: string
  url: string
  timestamp: string
  date: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  creator_id: string
  assignee_id: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'closed' | 'archived'
  due_date: string | null
  recurring: 'Daily' | 'Weekly' | 'Monthly' | null
  attachments: Array<{ url: string; name: string; size: number; type: string }>
  created_at: string
}

export interface TaskAssignee {
  task_id: string
  user_id: string
}

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  body: string
  attachments: unknown | null
  created_at: string
}

export interface LeaveRequest {
  id: string
  user_id: string
  type: 'Annual' | 'Medical' | 'Time-off'
  start_date: string
  end_date: string
  hours: number | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface PublicHoliday {
  id: string
  date: string
  name: string
  country: 'SG' | 'MY' | 'PH'
  sub_account: string
}

export interface Document {
  id: string
  user_id: string
  title: string
  type: 'Standard' | 'Medical' | 'ID'
  url: string
  size: number
  created_at: string
}

export interface KPI {
  id: string
  user_id: string
  responsibilities: string[]
  duties: string[]
  checklists: Array<{ text: string; done: boolean }>
  updated_at: string
}

export interface Subscription {
  id: string
  sub_account: string
  plan: 'free' | 'basic' | 'business' | 'professional'
  seats: number
  status: 'active' | 'cancelled' | 'trialing'
  billing_date: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: 'task_assigned' | 'task_reply' | 'task_completed' | 'task_closed' | 'leave_request' | 'leave_approved'
  message: string
  read: boolean
  created_at: string
}

export interface EodReport {
  id: string
  user_id: string
  date: string
  body: string
  created_at: string
}
