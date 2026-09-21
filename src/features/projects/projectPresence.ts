import { isIdle } from '@/lib/activity'

export type PresenceStatus = 'online' | 'idle' | 'offline'

// Matches TeamAvatarRow.tsx's existing presence semantics exactly, so
// Projects' header looks and behaves identically to the Team Status
// indicator already shipped elsewhere: idle only applies while 'working'
// (never while on lunch), offline means no active session at all.
export function presenceFromStatus(
  status: 'working' | 'lunch' | null,
  lastActivityAt: string | null,
): PresenceStatus {
  if (!status) return 'offline'
  if (status === 'working' && isIdle(lastActivityAt)) return 'idle'
  return 'online'
}
