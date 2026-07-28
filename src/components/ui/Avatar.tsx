type PresenceStatus = 'online' | 'idle' | 'offline'

interface AvatarProps {
  name: string
  imageUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  online?: boolean
  status?: PresenceStatus
}

const sizes: Record<string, string> = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
}

const DOT_COLOR: Record<PresenceStatus, string> = {
  online:  'bg-green-500',
  idle:    'bg-violet-400',
  offline: 'bg-red-400',
}

export function Avatar({ name, imageUrl, size = 'md', online, status }: AvatarProps) {
  const initials = name.slice(0, 2).toUpperCase()
  // `status` takes priority when given; `online` stays supported for callers
  // that only care about a plain two-state dot.
  const resolvedStatus = status ?? (online === undefined ? undefined : online ? 'online' : 'offline')
  return (
    <div className="relative inline-flex flex-shrink-0">
      {imageUrl ? (
        <img src={imageUrl} alt={name} className={`rounded-full object-cover ${sizes[size]}`} />
      ) : (
        <div className={`rounded-full bg-violet-100 text-violet-700 font-semibold flex items-center justify-center ${sizes[size]}`}>
          {initials}
        </div>
      )}
      {resolvedStatus && (
        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${DOT_COLOR[resolvedStatus]}`} />
      )}
    </div>
  )
}
