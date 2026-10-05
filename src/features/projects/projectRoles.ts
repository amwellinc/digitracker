import type { User } from '@/types'

// Associates get project notifications from database triggers
// (20261006000300); client-side inserts must skip them to avoid duplicates —
// and associates themselves can't insert notifications at all.
export function isAssociateMember(members: User[], id: string): boolean {
  return members.find(m => m.id === id)?.role === 'Associate'
}
